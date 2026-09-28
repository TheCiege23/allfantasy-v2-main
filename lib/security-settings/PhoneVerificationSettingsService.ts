/**
 * Client-side service for phone verification from settings.
 * Calls existing /api/verify/phone/start and /api/verify/phone/check.
 */

export interface StartPhoneVerificationResult {
  ok: boolean
  error?: string
  rateLimited?: boolean
}

export interface CheckPhoneCodeResult {
  ok: boolean
  error?: "INVALID_CODE" | "RATE_LIMITED" | string
}

export async function startPhoneVerification(
  phone: string,
  opts?: { smsConsent?: boolean; consentSource?: string }
): Promise<StartPhoneVerificationResult> {
  const normalized = phone.replace(/[\s()-]/g, "").trim()
  const withCountry = normalized.startsWith("+") ? normalized : `+1${normalized}`
  const res = await fetch("/api/verify/phone/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      phone: withCountry,
      smsConsent: opts?.smsConsent === true,
      consentSource: opts?.consentSource,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 429) return { ok: false, rateLimited: true, error: data.message ?? "Too many attempts" }
  if (!res.ok) return { ok: false, error: data.error ?? data.message ?? "Failed to send code" }
  return { ok: true }
}

export async function checkPhoneCode(phone: string, code: string): Promise<CheckPhoneCodeResult> {
  const normalized = phone.replace(/[\s()-]/g, "").trim()
  const withCountry = normalized.startsWith("+") ? normalized : `+1${normalized}`
  const res = await fetch("/api/verify/phone/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: withCountry, code: code.trim() }),
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 429) return { ok: false, error: "RATE_LIMITED" }
  if (!res.ok) return { ok: false, error: data.error ?? "VERIFY_FAILED" }
  return { ok: true }
}
