// One-time OAuth install flow for the custom "Fairway Route" app created in
// Shopify's Dev Dashboard. Dev Dashboard apps (unlike the old legacy custom
// app screen) don't hand you a static access token to copy — they issue one
// only via the standard OAuth authorization-code flow. This module runs
// that flow once and stores the resulting offline token in Postgres, so
// nobody has to copy a secret around by hand again after that.
//
// SHOPIFY_API_KEY / SHOPIFY_API_SECRET come from the app's "Client ID" /
// "Client secret" in the Dev Dashboard's API credentials section — those
// ARE shown up front, no OAuth needed to see them.
const crypto = require("crypto");
const express = require("express");
const { pool } = require("./db");
const { asyncHandler } = require("./asyncHandler");

const router = express.Router();

const API_KEY = process.env.SHOPIFY_API_KEY;
const API_SECRET = process.env.SHOPIFY_API_SECRET;
const SCOPES = process.env.SHOPIFY_SCOPES || "read_orders,read_products";
// Must exactly match this app's deployed URL, and must be added to the
// app's "Allowed redirection URL(s)" in the Dev Dashboard.
const APP_URL = process.env.APP_URL; // e.g. https://fairway-route.up.railway.app

function isValidShopDomain(shop) {
  return typeof shop === "string" && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop);
}

function verifyHmac(query) {
  const { hmac, signature, ...rest } = query;
  if (!hmac) return false;
  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${Array.isArray(rest[key]) ? rest[key].join(",") : rest[key]}`)
    .join("&");
  const digest = crypto.createHmac("sha256", API_SECRET).update(message).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(String(hmac)));
  } catch {
    return false;
  }
}

// Step 1: GET /auth/shopify?shop=your-store.myshopify.com
// Visit this once (as the store owner, logged into Shopify admin) to kick
// off installation.
router.get("/auth/shopify", asyncHandler(async (req, res) => {
  if (!API_KEY || !API_SECRET || !APP_URL) {
    return res.status(503).send(
      "Set SHOPIFY_API_KEY, SHOPIFY_API_SECRET, and APP_URL in Railway's Variables tab first."
    );
  }
  const shop = req.query.shop;
  if (!isValidShopDomain(shop)) {
    return res.status(400).send("Pass ?shop=your-store.myshopify.com (the *.myshopify.com domain).");
  }

  const state = crypto.randomBytes(16).toString("hex");
  await pool.query("DELETE FROM shopify_oauth_state WHERE created_at < now() - interval '10 minutes'");
  await pool.query("INSERT INTO shopify_oauth_state (state, shop_domain) VALUES ($1,$2)", [state, shop]);

  const redirectUri = `${APP_URL.replace(/\/$/, "")}/auth/shopify/callback`;
  const authorizeUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(API_KEY)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  res.redirect(authorizeUrl);
}));

// Step 2: Shopify redirects here after the merchant approves the scopes.
router.get("/auth/shopify/callback", asyncHandler(async (req, res) => {
  const { shop, code, state } = req.query;

  if (!isValidShopDomain(shop)) return res.status(400).send("Invalid shop.");
  if (!verifyHmac(req.query)) return res.status(401).send("Invalid request signature.");

  const { rows } = await pool.query(
    "SELECT * FROM shopify_oauth_state WHERE state = $1 AND shop_domain = $2",
    [state, shop]
  );
  if (!rows[0]) return res.status(401).send("Invalid or expired state — start the install again.");
  await pool.query("DELETE FROM shopify_oauth_state WHERE state = $1", [state]);

  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: API_KEY, client_secret: API_SECRET, code }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    return res.status(502).send("Could not exchange code for a token: " + text);
  }
  const tokenJson = await tokenRes.json();

  await pool.query(
    `INSERT INTO shopify_credentials (shop_domain, access_token, scope)
     VALUES ($1,$2,$3)
     ON CONFLICT (shop_domain) DO UPDATE SET access_token = $2, scope = $3, installed_at = now()`,
    [shop, tokenJson.access_token, tokenJson.scope]
  );

  res.send(
    `<body style="font-family:sans-serif;padding:40px;max-width:520px;margin:0 auto;">` +
      `<h2>Fairway Route is connected to ${shop}</h2>` +
      `<p>The access token was saved. Order lookup is live — you can close this tab.</p>` +
      `</body>`
  );
}));

// Used by shopify.js to fetch whichever shop's token was installed most
// recently. Fine for a single-store setup; if this ever serves multiple
// shops, look up by domain per request instead.
async function getStoredCredentials() {
  const { rows } = await pool.query(
    "SELECT shop_domain, access_token FROM shopify_credentials ORDER BY installed_at DESC LIMIT 1"
  );
  return rows[0] || null;
}

module.exports = { router, getStoredCredentials };
