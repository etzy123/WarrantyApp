// Generates a purchase-reference PDF for a claim, attached to the email a
// brand gets when a claim routes to them — lets the brand see what was
// actually bought and when, without needing to ask the customer or dig
// through their own records.
//
// NOTE: this is documentation to support a warranty claim, not a formal tax
// invoice — it doesn't calculate or show VAT. If you want to use this as an
// actual billing document (e.g. charging the brand for a replacement), talk
// to an accountant about what a compliant invoice needs to include for your
// situation before relying on it that way.
const PDFDocument = require("pdfkit");

const COMPANY_NAME = process.env.COMPANY_NAME || "Bisque Golf";
const COMPANY_ADDRESS = process.env.COMPANY_ADDRESS || "";
const COMPANY_VAT_NUMBER = process.env.COMPANY_VAT_NUMBER || "";

function fmtMoney(amount, currency) {
  const n = Number(amount);
  if (Number.isNaN(n)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "EUR" }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency || ""}`.trim();
  }
}

function fmtDate(d) {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
}

// Returns a Buffer containing the finished PDF.
function buildClaimInvoice(claim, brand) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const quantity = claim.quantity || 1;
    const unitPrice = claim.unit_price != null ? Number(claim.unit_price) : null;
    const currency = claim.currency || "EUR";
    const lineTotal = unitPrice != null ? unitPrice * quantity : null;

    // ---------- header ----------
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#1A2620").text(COMPANY_NAME);
    doc.font("Helvetica").fontSize(9).fillColor("#57685C");
    if (COMPANY_ADDRESS) doc.text(COMPANY_ADDRESS);
    if (COMPANY_VAT_NUMBER) doc.text(`VAT: ${COMPANY_VAT_NUMBER}`);
    doc.moveDown(1.5);

    doc.font("Helvetica-Bold").fontSize(16).fillColor("#1A2620").text("Purchase Invoice", { continued: false });
    doc.font("Helvetica").fontSize(9).fillColor("#57685C").text("Supporting documentation for a warranty claim — not a tax invoice.");
    doc.moveDown(1);

    // ---------- meta ----------
    const metaTop = doc.y;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#57685C").text("REFERENCE", 50, metaTop);
    doc.font("Helvetica").fontSize(11).fillColor("#1A2620").text(claim.id, 50, metaTop + 12);

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#57685C").text("DATE ISSUED", 220, metaTop);
    doc.font("Helvetica").fontSize(11).fillColor("#1A2620").text(fmtDate(new Date().toISOString()), 220, metaTop + 12);

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#57685C").text("ORDER DATE", 390, metaTop);
    doc.font("Helvetica").fontSize(11).fillColor("#1A2620").text(fmtDate(claim.order_date), 390, metaTop + 12);

    doc.moveDown(3);

    // ---------- bill to ----------
    const billTop = doc.y;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#57685C").text("BILL TO", 50, billTop);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#1A2620").text(brand.name, 50, billTop + 12);
    doc.font("Helvetica").fontSize(10).fillColor("#57685C");
    if (brand.contact_role) doc.text(brand.contact_role, 50);
    if (brand.contact_email) doc.text(brand.contact_email, 50);

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#57685C").text("ORDER NUMBER", 390, billTop);
    doc.font("Helvetica").fontSize(11).fillColor("#1A2620").text(claim.order_number ? `#${claim.order_number}` : "—", 390, billTop + 12);

    doc.moveDown(3);

    // ---------- line item table ----------
    const tableTop = doc.y + 10;
    const col = { product: 50, sku: 260, qty: 340, unit: 390, total: 470 };
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#57685C");
    doc.text("PRODUCT", col.product, tableTop);
    doc.text("SKU", col.sku, tableTop);
    doc.text("QTY", col.qty, tableTop);
    doc.text("UNIT PRICE", col.unit, tableTop);
    doc.text("LINE TOTAL", col.total, tableTop);
    doc.moveTo(50, tableTop + 14).lineTo(545, tableTop + 14).strokeColor("#DCE2D8").stroke();

    const rowTop = tableTop + 22;
    doc.font("Helvetica").fontSize(10).fillColor("#1A2620");
    doc.text(claim.product_title || "—", col.product, rowTop, { width: 200 });
    doc.text(claim.sku || "—", col.sku, rowTop, { width: 70 });
    doc.text(String(quantity), col.qty, rowTop, { width: 40 });
    doc.text(unitPrice != null ? fmtMoney(unitPrice, currency) : "—", col.unit, rowTop, { width: 70 });
    doc.text(lineTotal != null ? fmtMoney(lineTotal, currency) : "—", col.total, rowTop, { width: 75 });

    doc.moveTo(50, rowTop + 24).lineTo(545, rowTop + 24).strokeColor("#DCE2D8").stroke();

    doc.font("Helvetica-Bold").fontSize(11).fillColor("#1A2620")
      .text("Total", col.unit, rowTop + 36)
      .text(lineTotal != null ? fmtMoney(lineTotal, currency) : "—", col.total, rowTop + 36, { width: 75 });

    // ---------- footer ----------
    doc.font("Helvetica").fontSize(9).fillColor("#8B988E")
      .text(
        `This document reflects the original purchase associated with warranty claim ${claim.id}` +
          (claim.order_number ? `, order #${claim.order_number}` : "") +
          `. Reported issue: "${claim.issue || ""}"`,
        50, rowTop + 70, { width: 495 }
      );

    doc.end();
  });
}

module.exports = { buildClaimInvoice };
