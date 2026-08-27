const { Resend } = require("resend");

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Until a sending domain is verified in Resend, FROM_ADDRESS should stay on
// Resend's shared test domain (onboarding@resend.dev) and can only deliver to
// the email you signed up to Resend with. Once bisquegolf.com is verified
// (Resend gives you DNS records to add), switch this to something like
// claims@bisquegolf.com.
const FROM_ADDRESS = process.env.EMAIL_FROM || "Bisque Golf Warranty Claims <onboarding@resend.dev>";
const INTERNAL_ADDRESS = process.env.INTERNAL_NOTIFY_EMAIL || null;

async function sendEmail({ to, subject, text }) {
  if (!resend) {
    console.warn(
      `[email] RESEND_API_KEY not set — skipping send. Would have sent "${subject}" to ${to}.`
    );
    return { skipped: true };
  }
  return resend.emails.send({ from: FROM_ADDRESS, to, subject, text });
}

async function notifyBrand(brand, claim) {
  const body =
    `Hi ${brand.contact_role || "there"},\n\n` +
    `Bisque Golf has a warranty claim for a ${claim.product_title}` +
    `${claim.sku ? ` (SKU ${claim.sku})` : ""}, order #${claim.order_number}.\n\n` +
    `Reported issue: "${claim.issue}"\n\n` +
    `Could you advise on next steps — replacement, repair, or more info needed?\n\n` +
    `Reference: ${claim.id}`;
  return sendEmail({
    to: brand.contact_email,
    subject: `Warranty claim ${claim.id} — ${claim.product_title}`,
    text: body,
  });
}

async function notifyInternalQC(claim) {
  if (!INTERNAL_ADDRESS) return { skipped: true, reason: "INTERNAL_NOTIFY_EMAIL not set" };
  const body =
    `A customer reported an issue with ${claim.product_title} (order #${claim.order_number}):\n\n` +
    `"${claim.issue}"\n\nNo brand to route to — this is one of ours. Pick it up in the QC queue.\n\n` +
    `Reference: ${claim.id}`;
  return sendEmail({
    to: INTERNAL_ADDRESS,
    subject: `In-house claim ${claim.id} — ${claim.product_title}`,
    text: body,
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

async function notifyCustomerStatus(claim, statusLabel) {
  if (!claim.customer_email) return { skipped: true, reason: "no customer email on file" };
  const body =
    `Hi ${claim.customer_name || "there"},\n\n` +
    `Your warranty claim ${claim.id} for ${claim.product_title} is now: ${statusLabel}.\n\n` +
    `We'll keep you posted as it moves along.\n\n— Bisque Golf`;
  return sendEmail({
    to: claim.customer_email,
    subject: `Update on your claim ${claim.id}`,
    text: body,
  });
}

module.exports = { notifyBrand, notifyInternalQC, notifyFlagged, notifyCustomerStatus };
