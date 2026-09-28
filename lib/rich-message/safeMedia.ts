/**
 * Safe media URL resolution for chat messages — only allow https or same-site relative URLs.
 */

/*
 * A placeholder origin to resolve a relative path against. `.invalid` is reserved (RFC 2606), so it
 * can never be a real host — which is what makes "did it stay on this origin" a clean test.
 */
const SAME_SITE_PROBE_ORIGIN = "https://same-site.invalid"

/**
 * True only for a path on THIS site: `/uploads/x.png`, never `//other-host/x.png`.
 *
 * ⚠ "STARTS WITH `/`" IS NOT THAT TEST. A browser reads `//host/x` as protocol-relative — another
 * host, fetched by every viewer — and it normalises `/\host/x` to the same thing, and strips a tab
 * or newline out of `/<TAB>/host/x` before parsing. Each of those starts with `/`. So the path is
 * rejected outright when it opens with two slashes of either kind or carries a control character,
 * AND it is resolved with the same WHATWG parser the browser uses, and must still land on the
 * origin it was resolved against. Either check alone is a list of the tricks somebody thought of.
 */
export function isSameSiteRelativePath(value: string): boolean {
  if (!value.startsWith("/")) return false
  if (/^[/\\][/\\]/.test(value)) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false
  try {
    return new URL(value, SAME_SITE_PROBE_ORIGIN).origin === SAME_SITE_PROBE_ORIGIN
  } catch {
    return false
  }
}

export function getSafeMessageMediaUrl(body: string): string | null {
  const trimmed = (body || "").trim()
  if (!trimmed) return null
  try {
    if (trimmed.startsWith("/")) return isSameSiteRelativePath(trimmed) ? trimmed : null
    const u = new URL(trimmed)
    if (u.protocol === "https:") return trimmed
    if (u.protocol === "http:" && (typeof window === "undefined" || window.location?.hostname === "localhost"))
      return trimmed
    return null
  } catch {
    return null
  }
}

export function isSafeToRenderMedia(url: string): boolean {
  return getSafeMessageMediaUrl(url) !== null
}
