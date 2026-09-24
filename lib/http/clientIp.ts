/**
 * THE rule for "which address is the client". Every IP-keyed decision — rate
 * limits, lockouts, geo fallback, the VPN check, identity signals — reads it
 * here, because twelve private copies of an older rule is how production spent
 * weeks keying all of them on Cloudflare.
 *
 * Order, and each step is there for a reason:
 *
 *  1. `cf-connecting-ip` — production is Cloudflare -> Railway, and behind it
 *     the other two headers are the proxy chain. Measured 2026-09-24:
 *     `x-forwarded-for` held a Cloudflare `172.69.x` hop and a relay, NEITHER of
 *     them the client. Cloudflare overwrites this header on every proxied
 *     request, so it cannot be set by a caller who comes through the hostname.
 *  2. `x-real-ip` — set by the platform edge from the TCP peer, so a caller
 *     cannot choose it. Used when no Cloudflare is in front (previews, local).
 *  3. `x-forwarded-for[0]` — LAST, because the first entry is whatever the
 *     caller sent. Reading it first let a rotated fake header buy unlimited
 *     attempts against any per-IP limit, including the admin login lockout.
 *
 * ⚠ ONE KNOWN LIMIT. A direct hit on the origin (bypassing Cloudflare) can set
 * `cf-connecting-ip` itself. That is the same trust boundary as the geo headers
 * (`cf-ipcountry` is equally forgeable there), so it is not new — but it is why
 * the origin should only accept traffic from Cloudflare.
 *
 * Header-only and synchronous: middleware calls this on every request.
 */

/** Anything with a header getter: `Headers`, and the `ReadonlyHeaders` from `next/headers`. */
export interface HeaderGetter {
  get(name: string): string | null
}

function first(headers: HeaderGetter, name: string): string | null {
  const raw = headers.get(name)
  if (!raw) return null
  const value = raw.split(",")[0]?.trim()
  return value ? value : null
}

/** The client's address, or `null` when no header names one. */
export function clientIpFromHeaders(headers: HeaderGetter): string | null {
  return first(headers, "cf-connecting-ip") ?? first(headers, "x-real-ip") ?? first(headers, "x-forwarded-for")
}
