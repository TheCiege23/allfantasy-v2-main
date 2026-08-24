/**
 * Unified auth intent resolution: where to send the user after login or signup.
 * One account, one session; redirect depends on product intent (next / callbackUrl).
 */

const DEFAULT_AFTER_LOGIN = "/core"
const DEFAULT_AFTER_SIGNUP = "/core"

/** Safe path: must start with / and not be a full URL (open redirect). */
export function safeRedirectPath(path: string | null | undefined): string {
  if (!isSafeInternalPath(path)) return DEFAULT_AFTER_LOGIN
  const trimmed = path.trim()
  return trimmed
}

function isSafeInternalPath(path: string | null | undefined): path is string {
  if (path == null || typeof path !== "string") return false
  const trimmed = path.trim()
  return trimmed.startsWith("/") && !trimmed.startsWith("//")
}

/** Resolve redirect after successful login. Prefer callbackUrl, then next. */
export function getRedirectAfterLogin(
  callbackUrl: string | null | undefined,
  next: string | null | undefined
): string {
  if (isSafeInternalPath(callbackUrl)) return callbackUrl.trim()
  if (isSafeInternalPath(next)) return next.trim()
  return DEFAULT_AFTER_LOGIN
}

/** Resolve redirect after successful signup (before or after verification). */
export function getRedirectAfterSignup(next: string | null | undefined): string {
  if (isSafeInternalPath(next)) return next.trim()
  return DEFAULT_AFTER_SIGNUP
}

/** Build login URL with intent preserved for after signup. */
export function loginUrlWithIntent(redirectPath: string): string {
  const safe = safeRedirectPath(redirectPath)
  return `/login?callbackUrl=${encodeURIComponent(safe)}`
}

/** Build signup URL with intent preserved for after signup. */
export function signupUrlWithIntent(redirectPath: string): string {
  const safe = safeRedirectPath(redirectPath)
  const enc = encodeURIComponent(safe)
  return `/signup?next=${enc}&callbackUrl=${enc}`
}

/** Compatibility alias for invite flows that name the post-signup destination returnTo. */
export function signupUrlWithReturnTo(returnTo: string): string {
  return signupUrlWithIntent(returnTo)
}
