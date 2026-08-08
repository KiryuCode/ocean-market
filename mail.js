/**
 * Order confirmation email (HTML receipt).
 *
 * Configure via .env — see .env.example.
 * If SMTP is not configured, send is skipped (order still succeeds).
 */

const nodemailer = require("nodemailer");
const { STORE_NAME, STORE_TAGLINE, formatPrice } = require("./config");

function env(name, fallback = "") {
  const v = process.env[name];
  return v === undefined || v === null ? fallback : String(v).trim();
}

function isMailConfigured() {
  return Boolean(env("SMTP_HOST") && env("SMTP_USER") && env("SMTP_PASS"));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildReceiptHtml({ order, lineItems, subtotal, hasPrices }) {
  const orderId = escapeHtml(order.order_id_display);
  const createdAt = escapeHtml(order.created_at);
  const customerEmail = escapeHtml(order.email || "Not provided");
  const phone = escapeHtml(order.phone || "Not provided");
  const storeName = escapeHtml(STORE_NAME);
  const storeTagline = escapeHtml(STORE_TAGLINE);

  const itemRows = lineItems
    .map((item) => {
      const name = escapeHtml(item.name);
      const sku = escapeHtml(item.productId);
      const qty = Number(item.quantity) || 1;
      const unit =
        item.unitPrice !== null && item.unitPrice !== undefined
          ? `$${formatPrice(item.unitPrice)} each`
          : "";
      const line =
        item.lineTotal !== null && item.lineTotal !== undefined
          ? `$${formatPrice(item.lineTotal)}`
          : "—";
      const desc = item.description
        ? `<div style="color:#5a6a7a;font-size:13px;margin-top:4px;">${escapeHtml(item.description)}</div>`
        : "";

      return `
        <tr>
          <td style="padding:14px 12px;border-bottom:1px solid #e4ebf2;vertical-align:top;">
            <div style="font-weight:600;color:#0b2a3d;">${name}</div>
            <div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#5a6a7a;margin-top:4px;">
              SKU: ${sku} · Qty: ${qty}${unit ? ` · ${unit}` : ""}
            </div>
            ${desc}
          </td>
          <td style="padding:14px 12px;border-bottom:1px solid #e4ebf2;text-align:right;white-space:nowrap;font-weight:600;color:#0b2a3d;">
            ${line}
          </td>
        </tr>`;
    })
    .join("");

  const totalsBlock = hasPrices
    ? `
      <tr>
        <td style="padding:10px 12px;text-align:right;color:#5a6a7a;">Subtotal</td>
        <td style="padding:10px 12px;text-align:right;font-weight:600;">$${formatPrice(subtotal)}</td>
      </tr>
      <tr>
        <td style="padding:4px 12px 10px;text-align:right;color:#5a6a7a;">Tax</td>
        <td style="padding:4px 12px 10px;text-align:right;">$0.00</td>
      </tr>
      <tr>
        <td style="padding:12px;text-align:right;font-size:16px;font-weight:700;color:#0b2a3d;border-top:2px solid #0b2a3d;">Total</td>
        <td style="padding:12px;text-align:right;font-size:16px;font-weight:700;color:#0b2a3d;border-top:2px solid #0b2a3d;">$${formatPrice(subtotal)}</td>
      </tr>`
    : `
      <tr>
        <td colspan="2" style="padding:12px;color:#5a6a7a;font-size:13px;">
          Pricing shown when products are still in the catalog.
        </td>
      </tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Receipt #${orderId} — ${storeName}</title>
</head>
<body style="margin:0;padding:0;background:#eef4f8;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a2b3c;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef4f8;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #d5e2ec;">
          <tr>
            <td style="background:linear-gradient(135deg,#0a4d68,#088395);padding:28px 24px;color:#ffffff;">
              <div style="font-size:22px;font-weight:700;letter-spacing:0.02em;">${storeName}</div>
              <div style="opacity:0.9;margin-top:4px;font-size:14px;">${storeTagline}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;">
              <h1 style="margin:0 0 4px;font-size:22px;color:#0b2a3d;">Order confirmation</h1>
              <p style="margin:0 0 20px;font-family:ui-monospace,Menlo,Consolas,monospace;color:#088395;font-size:15px;">
                Order #${orderId}
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;background:#f6fafc;border-radius:8px;">
                <tr>
                  <td style="padding:16px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
                      <tr>
                        <td style="padding:4px 0;color:#5a6a7a;width:140px;">Date</td>
                        <td style="padding:4px 0;font-family:ui-monospace,Menlo,Consolas,monospace;">${createdAt}</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;color:#5a6a7a;">Customer email</td>
                        <td style="padding:4px 0;">${customerEmail}</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;color:#5a6a7a;">Phone</td>
                        <td style="padding:4px 0;font-family:ui-monospace,Menlo,Consolas,monospace;">${phone}</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;color:#5a6a7a;">Status</td>
                        <td style="padding:4px 0;"><span style="display:inline-block;background:#d8f3dc;color:#1b4332;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;">Confirmed</span></td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <h2 style="margin:0 0 12px;font-size:15px;text-transform:uppercase;letter-spacing:0.06em;color:#5a6a7a;">Items</h2>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4ebf2;border-radius:8px;overflow:hidden;">
                ${itemRows || `<tr><td style="padding:16px;color:#5a6a7a;">No line items found.</td></tr>`}
                ${totalsBlock}
              </table>

              <p style="margin:24px 0 0;font-size:13px;color:#5a6a7a;line-height:1.5;">
                Thank you for your order. Keep this receipt for your records.<br>
                ${storeName} · Demo store receipt — no payment was processed.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function createTransport() {
  const port = Number(env("SMTP_PORT", "587")) || 587;
  const secure =
    env("SMTP_SECURE", "").toLowerCase() === "true" || port === 465;

  return nodemailer.createTransport({
    host: env("SMTP_HOST"),
    port,
    secure,
    auth: {
      user: env("SMTP_USER"),
      pass: env("SMTP_PASS"),
    },
  });
}

/**
 * Send HTML order receipt to EMAIL_TO.
 * Never throws — logs errors so checkout is not blocked.
 */
async function sendOrderConfirmation({ order, lineItems, subtotal, hasPrices }) {
  const to = env("EMAIL_TO");
  if (!to) {
    console.warn("[mail] EMAIL_TO not set — skipping order confirmation email");
    return { skipped: true, reason: "EMAIL_TO missing" };
  }
  if (!isMailConfigured()) {
    console.warn(
      "[mail] SMTP_HOST / SMTP_USER / SMTP_PASS not fully set — skipping email"
    );
    return { skipped: true, reason: "SMTP not configured" };
  }

  const orderId = order.order_id_display;
  const from = env("SMTP_FROM") || env("SMTP_USER");
  const html = buildReceiptHtml({ order, lineItems, subtotal, hasPrices });
  const itemSummary = lineItems
    .map((i) => `${i.name} ×${i.quantity}`)
    .join(", ");

  try {
    const transport = createTransport();
    const info = await transport.sendMail({
      from,
      to,
      subject: `${STORE_NAME} — Order #${orderId} confirmation`,
      text: [
        `${STORE_NAME} order confirmation`,
        `Order #${orderId}`,
        `Date: ${order.created_at}`,
        `Customer email: ${order.email || "Not provided"}`,
        `Phone: ${order.phone || "Not provided"}`,
        `Items: ${itemSummary || "—"}`,
        hasPrices ? `Total: $${formatPrice(subtotal)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      html,
    });
    console.log(`[mail] Order #${orderId} confirmation sent to ${to}`, info.messageId || "");
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[mail] Failed to send order #${orderId} email:`, err.message || err);
    return { ok: false, error: err.message || String(err) };
  }
}

module.exports = {
  isMailConfigured,
  sendOrderConfirmation,
  buildReceiptHtml,
};
