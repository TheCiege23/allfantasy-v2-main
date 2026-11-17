/**
 * Client-side service for email verification from settings.
 * Calls existing /api/auth/verify-email/send.
 */

interface SendVerificationEmailResult {
  ok: boolean
  alreadyVerified?: boolean
  error?: string
  loginRequired?: boolean
  rateLimited?: boolean
}

export async function sendVerificationEmail(returnTo?: string): Promise<SendVerificationEmailResult> {
  const res = await fetch("/api/auth/verify-email/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ returnTo: returnTo ?? "/settings" }),
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) return { ok: false, loginRequired: true }
  if (res.status === 429) return { ok: false, rateLimited: true, error: data.message ?? "Too many attempts" }
  if (res.ok && data.alreadyVerified) return { ok: true, alreadyVerified: true }
  if (res.ok) return { ok: true }
  return { ok: false, error: data.error ?? data.message ?? "Failed to send" }
}
