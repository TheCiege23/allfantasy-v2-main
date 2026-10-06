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

export type LegalPageSearchParams = { from?: string; next?: string }

/**
 * The back link every legal page shows: to sign-up (keeping `next`) when the reader
 * arrived from the sign-up form's links, otherwise home.
 */
export async function resolveLegalBackLink(
  searchParams?: Promise<LegalPageSearchParams> | LegalPageSearchParams,
): Promise<{ href: string; label: string; fromSignup: boolean }> {
  const params = (await searchParams) ?? {}
  if (params.from !== "signup") return { href: "/", label: "Back to home", fromSignup: false }
  const next = typeof params.next === "string" ? params.next : undefined
  return { href: getSignupReturnUrl(next), label: "Back to sign up", fromSignup: true }
}

export function getSmsTermsUrl(): string {
  return "/sms-terms"
}

export function getCopyrightPolicyUrl(): string {
  return "/copyright"
}
