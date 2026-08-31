const sgMail = require("@sendgrid/mail");
const { pool } = require("./db");
const { buildClaimInvoice } = require("./invoice");

if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const sendgridReady = !!process.env.SENDGRID_API_KEY;

// Until support@bisquegolf.com (or bisquegolf.com generally) is a verified
// sender in SendGrid, sends from it will be rejected by SendGrid itself —
// verify the domain (or single sender) in SendGrid's dashboard first, then
// set EMAIL_FROM to "Bisque Golf Support <support@bisquegolf.com>".
const FROM_ADDRESS = process.env.EMAIL_FROM || "Bisque Golf Warranty Claims <no-reply@bisquegolf.com>";
const INTERNAL_ADDRESS = process.env.INTERNAL_NOTIFY_EMAIL || null;

// CC'd on every outbound brand/customer email so the inbox itself becomes a
// paper trail per claim — separate from INTERNAL_NOTIFY_EMAIL, which is only
// used for claims that never leave the building (in-house / flagged).
const SUPPORT_CC = process.env.SUPPORT_CC_EMAIL || "support@bisquegolf.com";

// "Name <email>" -> {name, email}; a bare email -> {email}. SendGrid accepts
// either shape for `from`/`to`/`cc`, but parsing keeps the display name
// working reliably.
function parseAddress(str) {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(str || "");
  if (match) return { name: match[1] || undefined, email: match[2] };
  return { email: str };
}

async function sendEmail({ to, cc, subject, text, attachments }) {
  if (!sendgridReady) {
    console.warn(
      `[email] SENDGRID_API_KEY not set — skipping send. Would have sent "${subject}" to ${to}${cc ? ` (cc ${cc})` : ""}.`
    );
    return { skipped: true };
  }
  const msg = {
    to,
    cc,
    from: parseAddress(FROM_ADDRESS),
    subject,
    text,
  };
  if (attachments && attachments.length) msg.attachments = attachments;
  try {
    return await sgMail.send(msg);
  } catch (err) {
    // SendGrid puts the useful detail in err.response.body, not err.message.
    const detail = err.response && err.response.body ? JSON.stringify(err.response.body) : err.message;
    throw new Error(`SendGrid send failed: ${detail}`);
  }
}

async function getPhotoAttachments(claimId) {
  const { rows } = await pool.query(
    "SELECT filename, mime_type, data FROM claim_photos WHERE claim_id = $1 ORDER BY id",
    [claimId]
  );
  return rows.map((r, i) => ({
    filename: r.filename || `photo-${i + 1}`,
    type: r.mime_type,
    content: r.data.toString("base64"),
    disposition: "attachment",
  }));
}

// Fills {{placeholders}} in the editable template. Unknown placeholders are
// left as-is rather than throwing, so a typo in the template doesn't break
// sending — it just shows up literally in the email, which is easy to spot.
function fillTemplate(str, vars) {
  return str.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
  );
}

async function getEmailTemplate() {
  const { rows } = await pool.query("SELECT subject, body FROM email_template WHERE id = 1");
  return rows[0] || null;
}

async function notifyBrand(brand, claim) {
  const template = await getEmailTemplate();
  const vars = {
    contact_role: brand.contact_role || "there",
    product_title: claim.product_title,
    sku: claim.sku || "",
    sku_suffix: claim.sku ? ` (SKU ${claim.sku})` : "",
    order_number: claim.order_number || "unknown",
    issue: claim.issue,
    claim_id: claim.id,
    customer_name: claim.customer_name || "",
  };

  const subject = template
    ? fillTemplate(template.subject, vars)
    : `Warranty claim ${claim.id} — ${claim.product_title}`;
  let body = template
    ? fillTemplate(template.body, vars)
    : `Hi ${brand.contact_role || "there"},\n\n` +
      `Bisque Golf has a warranty claim for a ${claim.product_title}` +
      `${claim.sku ? ` (SKU ${claim.sku})` : ""}, order #${claim.order_number}.\n\n` +
      `Reported issue: "${claim.issue}"\n\n` +
      `Could you advise on next steps — replacement, repair, or more info needed?\n\n` +
      `Reference: ${claim.id}`;

  const attachments = await getPhotoAttachments(claim.id);

  // Bundles the purchase invoice into this same email whenever there's
  // purchase data to build one from (i.e. the claim came from a real
  // Shopify order match) — no separate click needed. A manually-entered
  // claim has no price/date on file, so it just goes out without one.
  const hasInvoice = claim.unit_price != null;
  if (hasInvoice) {
    const pdfBuffer = await buildClaimInvoice(claim, brand);
    attachments.push({
      filename: `invoice-${claim.id}.pdf`,
      type: "application/pdf",
      content: pdfBuffer.toString("base64"),
      disposition: "attachment",
    });
  }

  const trailerParts = [];
  if (hasInvoice) trailerParts.push("a purchase invoice for this order");
  if (attachments.length > (hasInvoice ? 1 : 0)) trailerParts.push("photos the customer provided");
  if (trailerParts.length) {
    body += `\n\n(Attached: ${trailerParts.join(" and ")}.)`;
  }

  return sendEmail({
    to: brand.contact_email,
    cc: SUPPORT_CC,
    subject,
    text: body,
    attachments,
  });
}

async function notifyInternalQC(claim) {
  if (!INTERNAL_ADDRESS) return { skipped: true, reason: "INTERNAL_NOTIFY_EMAIL not set" };
  const body =
    `A customer reported an issue with ${claim.product_title} (order #${claim.order_number}):\n\n` +
    `"${claim.issue}"\n\nNo brand to route to — this is one of ours. Pick it up in the QC queue.\n\n` +
    `Reference: ${claim.id}`;
  const attachments = await getPhotoAttachments(claim.id);
  return sendEmail({
    to: INTERNAL_ADDRESS,
    subject: `In-house claim ${claim.id} — ${claim.product_title}`,
    text: body,
    attachments,
  });
}

async function notifyFlagged(claim) {
  if (!INTERNAL_ADDRESS) return { skipped: true, reason: "INTERNAL_NOTIFY_EMAIL not set" };
  const body =
    `Claim ${claim.id} (${claim.product_title}) couldn't be matched to one brand contact ` +
    `confidently and needs manual routing.\n\nCustomer: ${claim.customer_name} <${claim.customer_email}>\n` +
    `Order: #${claim.order_number}\nIssue: "${claim.issue}"`;
  return sendEmail({
    to: INTERNAL_ADDRESS,
    subject: `Needs routing: claim ${claim.id}`,
    text: body,
  });
}

// Always fires to SUPPORT_CC the moment any claim is created, regardless of
// routing outcome or whether the customer gave an email — unlike the
// customer-confirmation CC (which only reaches support piggybacked on an
// email that exists) or the brand-email CC (external claims only), this is
// the one guaranteed "a claim came in" alert.
async function notifyInternalNewClaim(claim) {
  const routingLabel =
    claim.routing_type === "house" ? "In-house (Bisque Golf)" :
    claim.routing_type === "ambiguous" ? "Unmatched — needs manual routing" :
    claim.brand_name || "External brand";
  const body =
    `A new warranty claim just came in.\n\n` +
    `Reference: ${claim.id}\n` +
    `Product: ${claim.product_title}${claim.sku ? ` (SKU ${claim.sku})` : ""}\n` +
    `Order: ${claim.order_number ? `#${claim.order_number}` : "not provided"}\n` +
    `Customer: ${claim.customer_name || "not provided"}${claim.customer_email ? ` <${claim.customer_email}>` : ""}\n` +
    `Routing: ${routingLabel}\n\n` +
    `Reported issue: "${claim.issue}"\n\n` +
    `View it in the ops dashboard for full details.`;
    return sendEmail({
     to: SUPPORT_CC,
+    // Also CC INTERNAL_ADDRESS (jelle@bisquegolf.com) when set, so this
+    // guaranteed "a claim came in" alert reaches a real inbox directly —
+    // SUPPORT_CC alone is support@bisquegolf.com mailing itself, which
+    // Gmail files without an INBOX label and so it's easy to miss entirely.
+    cc: INTERNAL_ADDRESS || undefined,
     subject: `New claim ${claim.id} — ${claim.product_title}`,
     text: body,
   });
 }

async function notifyCustomerSubmitted(claim) {
  if (!claim.customer_email) return { skipped: true, reason: "no customer email on file" };
  const body =
    `Hi ${claim.customer_name || "there"},\n\n` +
    `We've received your warranty claim for ${claim.product_title}` +
    `${claim.order_number ? ` (order #${claim.order_number})` : ""} and we're on it.\n\n` +
    `Reference: ${claim.id}\n\n` +
    `We'll email you again as soon as there's an update — no need to reply to this one.\n\n— Bisque Golf`;
  // Not CC'd to SUPPORT_CC on purpose — notifyInternalNewClaim() already
  // tells support about this exact claim the moment it's created, so CC'ing
  // this one too would mean two "new claim" emails landing in the same
  // inbox for the same event.
  return sendEmail({
    to: claim.customer_email,
    subject: `We've got your claim — ${claim.id}`,
    text: body,
  });
}

async function notifyCustomerStatus(claim, statusLabel) {
  if (!claim.customer_email) return { skipped: true, reason: "no customer email on file" };
  const body =
    `Hi ${claim.customer_name || "there"},\n\n` +
    `Your warranty claim ${claim.id} for ${claim.product_title} is now: ${statusLabel}.\n\n` +
    `We'll keep you posted as it moves along.\n\n— Bisque Golf`;
  return sendEmail({
    to: claim.customer_email,
    cc: SUPPORT_CC,
    subject: `Update on your claim ${claim.id}`,
    text: body,
  });
}

async function sendClaimInvoice(brand, claim, pdfBuffer) {
  const body =
    `Hi ${brand.contact_role || "there"},\n\n` +
    `Attached is the purchase invoice for the item in warranty claim ${claim.id} (${claim.product_title}), ` +
    `for your records.\n\n` +
    `Reference: ${claim.id}`;
  return sendEmail({
    to: brand.contact_email,
    cc: SUPPORT_CC,
    subject: `Purchase invoice — claim ${claim.id}`,
    text: body,
    attachments: [
      {
        filename: `invoice-${claim.id}.pdf`,
        type: "application/pdf",
        content: pdfBuffer.toString("base64"),
        disposition: "attachment",
      },
    ],
  });
}

module.exports = { notifyBrand, notifyInternalQC, notifyFlagged, notifyCustomerStatus, notifyCustomerSubmitted, notifyInternalNewClaim, sendClaimInvoice, getEmailTemplate, fillTemplate };
