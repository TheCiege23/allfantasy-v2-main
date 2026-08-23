/**
 * Unified auth intent resolution: where to send the user after login or signup.
 * One account, one session; redirect depends on product intent (next / callbackUrl).
 */

const DEFAULT_AFTER_LOGIN = "/dashboard"
const DEFAULT_AFTER_SIGNUP = "/dashboard"

/** Safe path: must start with / and not be a full URL (open redirect). */
export function safeRedirectPath(path: string | null | undefined): string {
  if (!isSafeInternalPath(path)) return DEFAULT_AFTER_LOGIN
  return stripUrlControlChars(path)
}

/**
 * ⚠ `startsWith("//")` ALONE IS NOT ENOUGH, AND THE GAP WAS EXPLOITABLE.
 *
 * Confirmed in a browser against /login: `?callbackUrl=/\\example.com/pwned`
 * passed this check — it starts with a single "/" — and then navigated the
 * signed-in user to http://example.com/pwned. Browsers normalise backslashes to
 * forward slashes when resolving a URL, so `/\host` and `/\\host` ARE `//host`,
 * i.e. protocol-relative, i.e. a different origin. The check read as correct
 * because it tested the string a human sees rather than the URL a browser
 * resolves.
 *
 * TAB, LF and CR are stripped by browsers before resolution for the same reason,
 * so they are removed before the test rather than allowed to smuggle a value
 * past it.
 *
 * The comparison is therefore made against a normalised copy, while the value
 * RETURNED stays the caller's own (minus control characters) — normalising the
 * return would silently rewrite legitimate paths.
 */
export function isSafeInternalPath(path: string | null | undefined): path is string {
  if (path == null || typeof path !== "string") return false
  const cleaned = stripUrlControlChars(path)
  if (!cleaned) return false
  const normalized = cleaned.replace(/\\/g, "/")
  return normalized.startsWith("/") && !normalized.startsWith("//")
}

/** TAB/LF/CR are removed by browsers before a URL is resolved; do the same first. */
function stripUrlControlChars(value: string): string {
  return value.replace(/[\t\n\r]/g, "").trim()
}

/** Resolve redirect after successful login. Prefer callbackUrl, then next. */
export function getRedirectAfterLogin(
  callbackUrl: string | null | undefined,
  next: string | null | undefined
): string {
  if (isSafeInternalPath(callbackUrl)) return stripUrlControlChars(callbackUrl)
  if (isSafeInternalPath(next)) return stripUrlControlChars(next)
  return DEFAULT_AFTER_LOGIN
}

/** Resolve redirect after successful signup (before or after verification). */
export function getRedirectAfterSignup(next: string | null | undefined): string {
  if (isSafeInternalPath(next)) return stripUrlControlChars(next)
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
