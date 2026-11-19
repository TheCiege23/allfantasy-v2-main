import crypto from "crypto";

export function getEarlyAccessWelcomeEmailV2(args: {
  email: string;
  baseUrl: string;
}) {
  const email = args.email.trim().toLowerCase();
  const baseUrl = args.baseUrl.replace(/\/+$/, "");

  const confirm = makeConfirmLink({ email, baseUrl });
  const dashboardUrl = `${baseUrl}/af-legacy`;

  const subject = "You're on the AllFantasy Early Access list";

  const html = `
  <div style="background:#0b0b0f;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;color:#fff">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden">
      <tr>
        <td style="padding:22px 22px 10px 22px;">
          <div style="font-size:12px;letter-spacing:0.10em;text-transform:uppercase;color:rgba(255,255,255,0.65)">
            AllFantasy - Early Access
          </div>
          <div style="font-size:24px;font-weight:800;margin-top:8px;line-height:1.15">
            You're in. Welcome to the list
          </div>
          <div style="font-size:14px;line-height:1.55;margin-top:10px;color:rgba(255,255,255,0.80)">
            We'll send your invite in waves. When your access opens, you'll be able to import your Sleeper history,
            unlock Chimmy legacy analysis, and start building leagues.
          </div>
        </td>
      </tr>

      <tr>
        <td style="padding:0 22px 18px 22px;">
          <div style="margin-top:10px;font-size:13px;color:rgba(255,255,255,0.70)">
            Signed up as: <span style="color:#fff;font-weight:600">${escapeHtml(email)}</span>
          </div>
        </td>
      </tr>

      <tr>
        <td style="padding:0 22px 22px 22px;">
          <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%">
            <tr>
              <td style="padding-right:10px;">
                <a href="${confirm.url}"
                  style="display:inline-block;background:#ffffff;color:#0b0b0f;text-decoration:none;font-weight:800;padding:12px 14px;border-radius:12px">
                  Confirm your spot
                </a>
              </td>
              <td>
                <a href="${dashboardUrl}"
                  style="display:inline-block;background:rgba(255,255,255,0.10);color:#ffffff;text-decoration:none;font-weight:700;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,0.12)">
                  Explore Legacy Tools
                </a>
              </td>
            </tr>
          </table>

          <div style="margin-top:14px;font-size:13px;line-height:1.5;color:rgba(255,255,255,0.70)">
            Confirming helps us prioritize real users for early access invites.
          </div>

          <div style="margin-top:14px;font-size:12px;color:rgba(255,255,255,0.50)">
            If you didn't sign up, you can ignore this email.
          </div>
        </td>
      </tr>

      <tr>
        <td style="padding:14px 22px;border-top:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.55);font-size:12px">
          AllFantasy - Invite-only early access - Sent automatically
        </td>
      </tr>
    </table>
  </div>
  `.trim();

  const text = `
AllFantasy - Early Access

You're in. Welcome to the list

We'll send your invite in waves. When your access opens, you'll be able to import your Sleeper history,
unlock Chimmy legacy analysis, and start building leagues.

Signed up as: ${email}

Confirm your spot: ${confirm.url}
Explore Legacy Tools: ${dashboardUrl}

If you didn't sign up, ignore this email.
`.trim();

  return { subject, html, text };
}

function makeConfirmLink(args: { email: string; baseUrl: string }) {
  const { email, baseUrl } = args;
  const secret = (process.env.EARLY_ACCESS_CONFIRM_SECRET || "").trim();

  if (!secret) {
    return { url: `${baseUrl}/?welcome=1` };
  }

  const ts = Date.now();
  const payload = `${email}|${ts}`;
  const token = base64urlEncode(payload);

  const sig = hmacBase64url(secret, token);

  const url = `${baseUrl}/early-access/confirm?t=${encodeURIComponent(
    token
  )}&s=${encodeURIComponent(sig)}`;

  return { url };
}

function hmacBase64url(secret: string, message: string) {
  const h = crypto.createHmac("sha256", secret).update(message).digest();
  return toBase64url(h);
}

function base64urlEncode(s: string) {
  return toBase64url(Buffer.from(s, "utf8"));
}

function toBase64url(buf: Buffer) {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
