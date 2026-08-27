const express = require("express");
const { pool } = require("./db");
const { findOrderByNumber } = require("./shopify");
const { notifyBrand, notifyInternalQC, notifyFlagged, notifyCustomerStatus } = require("./email");
const { requireOpsAuth } = require("./auth");
const { asyncHandler } = require("./asyncHandler");
const { rateLimit } = require("./rateLimit");

const router = express.Router();

const STAGE_ORDER = ["submitted", "routed", "processing", "resolved"];

// Order lookup requires the order's own email to match — without this,
// anyone could enumerate order numbers and read back names/emails, which
// is both a privacy problem and a real GDPR exposure. Rate-limited on top
// of that so guessing email+order combinations isn't cheap.
const orderLookupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

function emailsMatch(a, b) {
  return typeof a === "string" && typeof b === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();
}

async function getBrand(name) {
  if (!name) return null;
  const { rows } = await pool.query("SELECT * FROM brands WHERE name = $1", [name]);
  return rows[0] || null;
}

function routingTypeFor(brand) {
  if (!brand) return "ambiguous";
  return brand.house ? "house" : "external";
}

function nextClaimId(seq) {
  return `BQ-${new Date().getFullYear()}-${String(seq).padStart(4, "0")}`;
}

// ---------- public: order lookup ----------
router.post("/order-lookup", orderLookupLimiter, asyncHandler(async (req, res) => {
  try {
    const { orderNumber, email } = req.body;
    if (!orderNumber) return res.status(400).json({ error: "orderNumber is required" });
    if (!email) return res.status(400).json({ error: "email is required" });

    const order = await findOrderByNumber(orderNumber);

    // Same generic response whether the order doesn't exist or the email
    // just doesn't match it — confirming "that order exists but your email
    // is wrong" would itself leak information to someone probing numbers.
    if (!order || !emailsMatch(order.customerEmail, email)) {
      return res.status(404).json({ error: "We couldn't find an order with that number and email." });
    }

    // Attach routing info per line item so the frontend can render the
    // "matched to X" / "in-house" / "needs manual routing" states without a
    // second round trip.
    const items = [];
    for (const item of order.items) {
      const brand = await getBrand(item.vendor);
      items.push({ ...item, routingType: routingTypeFor(brand) });
    }

    res.json({ ...order, items });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
}));

// ---------- public: brand directory (read-only, used by the customer form's manual fallback) ----------
router.get("/brands", asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    "SELECT name, units_sold, house, contact_role, contact_email FROM brands ORDER BY units_sold DESC"
  );
  res.json(rows);
}));

// ---------- public: submit a claim ----------
router.post("/claims", asyncHandler(async (req, res) => {
  try {
    const { orderNumber, customerName, customerEmail, brandName, productTitle, sku, issue } = req.body;
    if (!productTitle || !issue) {
      return res.status(400).json({ error: "productTitle and issue are required" });
    }

    const brand = await getBrand(brandName);
    const routingType = routingTypeFor(brand);
    const stage = routingType === "ambiguous" ? "attention" : "submitted";

    const { rows: countRows } = await pool.query("SELECT count(*)::int AS n FROM claims");
    const id = nextClaimId(countRows[0].n + 825); // keeps ids clear of the seeded demo range

    await pool.query(
      `INSERT INTO claims (id, order_number, customer_name, customer_email, brand_name, routing_type, product_title, sku, issue, stage)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, orderNumber || null, customerName || null, customerEmail || null, brand ? brand.name : null, routingType, productTitle, sku || null, issue, stage]
    );

    const { rows } = await pool.query("SELECT * FROM claims WHERE id = $1", [id]);
    const claim = rows[0];

    // Fire the appropriate notification. Kept synchronous but non-fatal —
    // a Resend hiccup shouldn't stop the claim from being recorded.
    try {
      if (routingType === "ambiguous") {
        await notifyFlagged(claim);
      } else if (routingType === "house") {
        await notifyInternalQC(claim);
        await pool.query("UPDATE claims SET stage = 'processing', updated_at = now() WHERE id = $1", [id]);
      } else {
        await notifyBrand(brand, claim);
        await pool.query("UPDATE claims SET stage = 'routed', updated_at = now() WHERE id = $1", [id]);
      }
    } catch (emailErr) {
      console.error("[claims] notification failed:", emailErr.message);
    }

    const { rows: finalRows } = await pool.query("SELECT * FROM claims WHERE id = $1", [id]);
    res.status(201).json(finalRows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create claim." });
  }
}));

// ---------- public: poll a single claim's status (for the customer tracker) ----------
router.get("/claims/:id", asyncHandler(async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM claims WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
}));

// ---------- ops (protected): full queue ----------
router.get("/ops/claims", requireOpsAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM claims ORDER BY created_at DESC LIMIT 200");
  res.json(rows);
}));

// ---------- ops (protected): advance a claim to its next stage ----------
router.post("/ops/claims/:id/advance", requireOpsAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM claims WHERE id = $1", [req.params.id]);
  const claim = rows[0];
  if (!claim) return res.status(404).json({ error: "Not found" });

  const idx = STAGE_ORDER.indexOf(claim.stage);
  if (idx === -1) return res.status(400).json({ error: `Cannot advance from stage "${claim.stage}"` });
  const next = STAGE_ORDER[Math.min(idx + 1, STAGE_ORDER.length - 1)];

  await pool.query("UPDATE claims SET stage = $1, updated_at = now() WHERE id = $2", [next, claim.id]);
  const { rows: updated } = await pool.query("SELECT * FROM claims WHERE id = $1", [claim.id]);

  try {
    await notifyCustomerStatus(updated[0], next);
  } catch (err) {
    console.error("[ops] customer notify failed:", err.message);
  }

  res.json(updated[0]);
}));

// ---------- ops (protected): manually route a flagged claim to a brand ----------
router.post("/ops/claims/:id/route", requireOpsAuth, asyncHandler(async (req, res) => {
  const { brandName } = req.body;
  const brand = await getBrand(brandName);
  if (!brand) return res.status(400).json({ error: "Unknown brand" });

  await pool.query(
    "UPDATE claims SET brand_name = $1, routing_type = 'external', stage = 'routed', updated_at = now() WHERE id = $2",
    [brand.name, req.params.id]
  );
  const { rows } = await pool.query("SELECT * FROM claims WHERE id = $1", [req.params.id]);
  const claim = rows[0];

  try {
    await notifyBrand(brand, claim);
  } catch (err) {
    console.error("[ops] brand notify failed:", err.message);
  }

  res.json(claim);
}));

module.exports = router;
