import { isSafeInternalPath, safeInternalPathOr } from "@/lib/auth/auth-intent-resolver"

/**
 * Resolves legal page back links and signup-return URLs.
 */
export function getSignupReturnUrl(next?: string | null): string {
  const path = safeInternalPathOr(next, "")
  return path ? `/signup?next=${encodeURIComponent(path)}` : "/signup"
}

export function getDisclaimerUrl(fromSignup?: boolean, next?: string | null): string {
  const params = new URLSearchParams()
  if (fromSignup) params.set("from", "signup")
  if (isSafeInternalPath(next)) params.set("next", next.trim())
  const q = params.toString()
  return q ? `/disclaimer?${q}` : "/disclaimer"
}

export function getTermsUrl(fromSignup?: boolean, next?: string | null): string {
  const params = new URLSearchParams()
  if (fromSignup) params.set("from", "signup")
  if (isSafeInternalPath(next)) params.set("next", next.trim())
  const q = params.toString()
  return q ? `/terms?${q}` : "/terms"
}

export function getPrivacyUrl(fromSignup?: boolean, next?: string | null): string {
  const params = new URLSearchParams()
  if (fromSignup) params.set("from", "signup")
  if (isSafeInternalPath(next)) params.set("next", next.trim())
  const q = params.toString()
  return q ? `/privacy?${q}` : "/privacy"
}

export function getDataDeletionUrl(fromSignup?: boolean, next?: string | null): string {
  const params = new URLSearchParams()
  if (fromSignup) params.set("from", "signup")
  if (isSafeInternalPath(next)) params.set("next", next.trim())
  const q = params.toString()
  return q ? `/data-deletion?${q}` : "/data-deletion"
}

export function getNoGamblingPolicyUrl(fromSignup?: boolean, next?: string | null): string {
  const params = new URLSearchParams()
  if (fromSignup) params.set("from", "signup")
  if (isSafeInternalPath(next)) params.set("next", next.trim())
  const q = params.toString()
  return q ? `/no-gambling-policy?${q}` : "/no-gambling-policy"
}
