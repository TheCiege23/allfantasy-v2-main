/**
 * Unified auth intent resolution: where to send the user after login or signup.
 * One account, one session; redirect depends on product intent (next / callbackUrl).
 */

const DEFAULT_AFTER_LOGIN = "/core"
const DEFAULT_AFTER_SIGNUP = "/core"

/** Safe path: must stay on this site once resolved (open redirect). */
export function safeRedirectPath(path: string | null | undefined): string {
  return safeInternalPathOr(path, DEFAULT_AFTER_LOGIN)
}

/** The trimmed path when {@link isSafeInternalPath} accepts it, otherwise `fallback`. */
export function safeInternalPathOr(path: unknown, fallback: string): string {
  return isSafeInternalPath(path) ? path.trim() : fallback
}

const PARSE_ORIGIN = "https://internal-path.invalid"
const BACKSLASH = 92
const DEL = 127

/**
 * Backslash, C0 controls and DEL. Browsers read a backslash as a slash and drop tab/CR/LF
 * before parsing. Compared by char code rather than a regex so no escaping layer can turn
 * the pattern into literal control bytes in this file.
 */
function hasUnsafePathChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === DEL || code === BACKSLASH) return true
  }
  return false
}

/**
 * A path that still points at this site after a browser or a Location header resolves it.
 *
 * ⚠ `startsWith("/") && !startsWith("//")` IS NOT THAT TEST, and it was the whole check here.
 * A path can pass it and still resolve to another host two ways:
 *   - a backslash or tab after the first slash, which browsers normalise to "//"
 *   - dot segments, which collapse during resolution into a pathname starting "//" — and
 *     `relativeRedirect` writes the resolved pathname into the Location header
 *
 * So parse it the way the sink will. Callers keep the trimmed ORIGINAL string, never the parsed
 * one: re-emitting the normalised pathname is exactly how a dot segment becomes "//host".
 */
export function isSafeInternalPath(path: unknown): path is string {
  if (typeof path !== "string") return false
  const trimmed = path.trim()
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return false
  if (hasUnsafePathChar(trimmed)) return false
  let url: URL
  try {
    url = new URL(trimmed, PARSE_ORIGIN)
  } catch {
    return false
  }
  return url.origin === PARSE_ORIGIN && !url.pathname.startsWith("//")
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
