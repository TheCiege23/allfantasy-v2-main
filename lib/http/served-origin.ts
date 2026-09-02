import { getDeploymentLinkOrigin, getPublicSiteOrigin } from "@/lib/site-public-origin"

/**
 * A route handler's request origin is the address the server was BOUND to.
 *
 * Next builds `req.url` (and `req.nextUrl`) in `attachRequestMeta`:
 *
 *   const initUrl = this.fetchHostname && this.port
 *     ? `${protocol}://${this.fetchHostname}:${this.port}${req.url}`
 *     : this.nextConfig.experimental.trustHostHeader
 *       ? `https://${req.headers.host || "localhost"}${req.url}`
 *       : req.url
 *
 * Railway needs every interface bound, so scripts/railway-next-start.cjs runs
 * `next start -H 0.0.0.0 -p 8080`, and the hostname cannot be dropped because
 * middleware.ts requires one ("To use middleware you must provide a `hostname`
 * and `port` to the Next.js Server"). The first branch therefore always wins and
 * every route handler sees `https://0.0.0.0:8080` — never the host the visitor
 * reached. `trustHostHeader` is unreachable for the same reason.
 *
 * Measured in production 2026-09-02, before this module existed:
 *
 *   /verify/email?token=…        → 307 https://0.0.0.0:8080/verify?error=INVALID_LINK
 *   /api/league/yahoo/callback   → 307 https://0.0.0.0:8080/login
 *   /api/auth/beta/claim         → 307 https://0.0.0.0:8080/signup?beta=1
 *   /api/league/yahoo-auth       → 307 https://0.0.0.0:8080/login?callbackUrl=…
 *
 * `0.0.0.0` is the unspecified address. It means "every interface" to a server
 * and nothing at all to a client, so each of those is a dead end.
 */

/** `0.0.0.0` / `::` — a bind address, never somewhere a browser can go. */
export function isBindAddressOrigin(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, "")
    return host === "0.0.0.0" || host === "::" || host === "" || host === "0"
  } catch {
    return false
  }
}

/** Local development, where the request origin IS the right answer. */
export function isLoopbackOrigin(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, "")
    return host === "localhost" || host === "127.0.0.1" || host === "::1"
  } catch {
    return false
  }
}

function originOf(req?: { url?: string } | null): string | null {
  const raw = req?.url
  if (!raw) return null
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

/**
 * The origin this deployment is actually served from — for the cases that need
 * an ABSOLUTE URL and cannot use a relative one: a link inside an email, an
 * OAuth `redirect_uri`, a self-directed fetch, a host comparison.
 *
 * Prefer `relativeRedirect` wherever the browser is the one following the URL.
 *
 * Order, and each step is there for a reason:
 *
 *  1. A loopback request origin wins, so local development keeps working even
 *     when a developer's .env.local names the production site.
 *  2. Otherwise the CONFIGURED origin, which is preview-aware and derived only
 *     from environment variables — never from a Host header, so an emailed link
 *     cannot be pointed at an attacker's host.
 *  3. The canonical site origin as the floor.
 *
 * The request origin is deliberately never used outside step 1: in production it
 * is the bind address, and anywhere `trustHostHeader` applies it is spoofable.
 */
export function getServedOrigin(req?: { url?: string } | null): string {
  const requestOrigin = originOf(req)
  if (requestOrigin && isLoopbackOrigin(requestOrigin)) return requestOrigin

  const configured = getDeploymentLinkOrigin()
  if (configured) return configured

  return getPublicSiteOrigin()
}
