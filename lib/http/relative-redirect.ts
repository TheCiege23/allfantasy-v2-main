import { NextResponse } from "next/server"

/**
 * Relative redirects, for the same reason lib/http/served-origin.ts exists: a route
 * handler's request origin is the address the server was BOUND to, not the host the
 * visitor reached. Kept in its own module so `getServedOrigin` stays free of
 * `next/server` and can be used from ordinary library code.
 */

/**
 * A redirect the browser resolves against the URL it actually requested.
 *
 * This is the right answer for anything the visitor follows — it is correct in
 * local dev, on a preview and in production at once, and it never has to decide
 * which host is "ours". `NextResponse.redirect` cannot express it: `validateURL`
 * does `new URL(String(url))` and throws on a relative one, which is why
 * /api/auth/logout returned 500 in production rather than logging anyone out.
 *
 * Only site-relative paths are accepted, so this cannot become an open redirect.
 */
export function relativeRedirect(path: string | URL, status = 307): NextResponse {
  const target = typeof path === "string" ? relativeUrl(path) : path
  // Only pathname + search + hash is ever emitted, so the placeholder base below
  // cannot escape and this cannot become an off-site redirect.
  return new NextResponse(null, {
    status,
    headers: { Location: `${target.pathname}${target.search}${target.hash}` },
  })
}

/**
 * A site-relative path parsed into a URL so its `searchParams` can be edited,
 * then handed back to `relativeRedirect`. The base is a placeholder that never
 * reaches the response.
 */
export function relativeUrl(path: string): URL {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error(`expected a site-relative path, got ${JSON.stringify(path)}`)
  }
  return new URL(path, "http://relative.invalid")
}
