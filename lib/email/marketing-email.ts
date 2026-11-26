import "server-only"

import crypto from "crypto"
import { getBaseUrl } from "@/lib/get-base-url"
import { getResendClient } from "@/lib/resend-client"

function secret(): string {
  const value =
    process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim() ||
    process.env.ADMIN_SESSION_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    ""
  if (!value) {
    throw new Error("Missing EMAIL_UNSUBSCRIBE_SECRET, ADMIN_SESSION_SECRET, AUTH_SECRET, or NEXTAUTH_SECRET")
  }
  return value
}
function base64url(value: string): string {
  return Buffer.from(value).toString("base64url")
}

function unbase64url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8")
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url")
}

export function createEmailUnsubscribeToken(email: string): string {
  const normalized = email.trim().toLowerCase()
  const payload = base64url(JSON.stringify({ email: normalized, purpose: "marketing_unsubscribe", v: 1 }))
  return `${payload}.${sign(payload)}`
}

export function verifyEmailUnsubscribeToken(token: string): { email: string } | null {
  const [payload, signature] = token.split(".")
  if (!payload || !signature) return null
  const expected = sign(payload)
  try {
    const a = Buffer.from(signature)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
    const decoded = JSON.parse(unbase64url(payload)) as { email?: unknown; purpose?: unknown }
    if (decoded.purpose !== "marketing_unsubscribe" || typeof decoded.email !== "string") return null
    return { email: decoded.email.trim().toLowerCase() }
  } catch {
    return null
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function textToHtml(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("\n")
}

export async function sendMarketingEmail(params: {
  to: string
  subject: string
  bodyText: string
  /** ISO instant to deliver at (Resend scheduling); omitted = send now. */
  scheduledAt?: string
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const { client, fromEmail } = getResendClient()
    const unsubscribeUrl = `${getBaseUrl()}/api/email/unsubscribe?token=${encodeURIComponent(
      createEmailUnsubscribeToken(params.to)
    )}`
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <main style="font-family:Arial,sans-serif;line-height:1.55;color:#0f172a;">
    ${textToHtml(params.bodyText)}
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
    <p style="font-size:12px;color:#64748b;">
      You are receiving this because you signed up for AllFantasy.ai product updates.
      <a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from marketing emails</a>.
    </p>
  </main>
</body>
</html>`

    const result = await client.emails.send({
      from: fromEmail,
      to: params.to,
      subject: params.subject,
      html,
      ...(params.scheduledAt ? { scheduledAt: params.scheduledAt } : {}),
    })
    if ("error" in result && result.error) {
      return { ok: false, error: result.error.message || "Email provider error" }
    }
    const id = "data" in result && result.data && "id" in result.data ? String(result.data.id) : undefined
    return { ok: true, id }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown email error" }
  }
}
