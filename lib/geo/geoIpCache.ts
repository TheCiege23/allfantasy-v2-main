/**
 * A cached IP → location lookup, so the MIDDLEWARE gate can enforce state
 * restrictions when no edge header placed the request.
 *
 * ⚠ WHY A CACHE IS THE WHOLE DESIGN, not an optimisation. `middleware.ts` runs
 * on essentially every request — its matcher excludes only static assets and
 * images — so a naive lookup would be one vendor call per page view per API
 * call per chunk. This module makes it ONE call per unique IP per TTL, and
 * every request after that is a Map read.
 *
 * The process is long-lived (Railway runs `next start`, not per-request
 * lambdas), so module-level state survives between requests and the hit rate is
 * high. On a platform with ephemeral instances this would need a shared L2 —
 * Upstash REST, as `lib/automation/locks.ts` already does it — and the seam for
 * that is `lookupUncached` below.
 *
 * ⚠ IT FAILS OPEN, DELIBERATELY, AND THAT IS NOT THE SAME AS NOT CARING.
 * Failing closed here would mean a vendor outage takes the whole product down
 * for everyone, and a geo gate that can black out the site is a worse hazard
 * than the one it guards. The precedent is already in this repo:
 * `detectVpnOrProxy` says "do not block solely due to check failure". The
 * honest framing is that this raises enforcement from NONE (measured
 * 2026-09-07: no edge header on any request, every gate open) to
 * best-effort-with-a-cache. Proxying the hostname through Cloudflare is what
 * makes it exact, and this module goes quiet the moment that happens, because
 * the header path short-circuits it.
 */

import { fetchIpApi } from "./geoIpFetch"
import { parseIpApiPayload } from "./geoIpParse"

export interface CachedGeo {
  country: string | null
  regionCode: string | null
}

/**
 * An IP's country does not change often, so a long TTL is safe and is what
 * keeps the vendor call count near the unique-visitor count rather than the
 * request count.
 */
const POSITIVE_TTL_MS = 6 * 60 * 60 * 1000

/**
 * ⚠ A FAILURE IS CACHED TOO, and briefly. Without this, an IP the vendor cannot
 * place retries on EVERY request from that IP — turning one outage into a
 * sustained outbound flood and adding the timeout to every page load. Short,
 * because a failure is far more likely to be transient than a success is to go
 * stale.
 */
const NEGATIVE_TTL_MS = 5 * 60 * 1000

/** Bounded so a scan or a botnet cannot grow this without limit. */
const MAX_ENTRIES = 10_000

/**
 * ⚠ MIDDLEWARE IS IN THE REQUEST PATH, so this budget is a user-visible latency
 * cap, not a politeness setting. It is paid at most once per IP per TTL.
 */
const LOOKUP_TIMEOUT_MS = 1_200

/** After this many consecutive failures, stop calling until the window passes. */
const BREAKER_THRESHOLD = 5
const BREAKER_COOLDOWN_MS = 60 * 1000

interface Entry {
  geo: CachedGeo | null
  expiresAt: number
}

const cache = new Map<string, Entry>()
const inFlight = new Map<string, Promise<CachedGeo | null>>()

let consecutiveFailures = 0
let breakerOpenUntil = 0

/** Test seam. Nothing in production should need to reset this. */
export function __resetGeoIpCache(): void {
  cache.clear()
  inFlight.clear()
  consecutiveFailures = 0
  breakerOpenUntil = 0
}

export function geoIpCacheStats(): { entries: number; inFlight: number; breakerOpen: boolean } {
  return {
    entries: cache.size,
    inFlight: inFlight.size,
    breakerOpen: Date.now() < breakerOpenUntil,
  }
}

/**
 * Private, loopback and link-local addresses, plus the unique-local IPv6 range.
 * Looking these up spends a request to be told "no", and in a container every
 * health check arrives from one.
 */
const NON_PUBLIC_IP =
  /^(?:10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i

export function isPublicIp(ip: string): boolean {
  const trimmed = ip.trim()
  if (trimmed === "") return false
  return !NON_PUBLIC_IP.test(trimmed)
}

function evictIfFull(): void {
  if (cache.size < MAX_ENTRIES) return
  // Map preserves insertion order, so the first key is the oldest write. Not a
  // true LRU — deliberately, because a real one needs a touch on every read and
  // this runs in the request path. Oldest-write is the cheap approximation.
  const oldest = cache.keys().next()
  if (!oldest.done) cache.delete(oldest.value)
}

async function lookupUncached(ip: string): Promise<CachedGeo | null> {
  const key = process.env.IPAPI_KEY?.trim()
  if (!key) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS)
  try {
    const payload = await fetchIpApi(ip, key, controller.signal)
    const parsed = parseIpApiPayload(payload)
    if (!parsed.country) return null
    return { country: parsed.country, regionCode: parsed.regionCode }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Resolve a location for one IP, from cache when possible.
 *
 * Returns `null` for "could not place", which callers must treat as UNKNOWN and
 * never as "not restricted" — the distinction that was lost when production
 * moved off Vercel.
 */
export async function resolveGeoByIp(ip: string): Promise<CachedGeo | null> {
  if (!isPublicIp(ip)) return null

  const now = Date.now()

  const hit = cache.get(ip)
  if (hit && hit.expiresAt > now) return hit.geo

  if (now < breakerOpenUntil) return null

  /*
   * ⚠ IN-FLIGHT DEDUP IS LOAD-BEARING, not a nicety. One page load fires the
   * document, the chunks and several API calls in parallel, and every one of
   * them enters this middleware with the same IP and an empty cache. Without
   * this map that is a dozen simultaneous vendor calls for a single visitor —
   * enough to hit a rate limit on the very first user and cache the failure.
   */
  const existing = inFlight.get(ip)
  if (existing) return existing

  const pending = lookupUncached(ip)
    .then((geo) => {
      consecutiveFailures = 0
      evictIfFull()
      cache.set(ip, { geo, expiresAt: Date.now() + (geo ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) })
      return geo
    })
    .catch(() => {
      consecutiveFailures += 1
      if (consecutiveFailures >= BREAKER_THRESHOLD) {
        breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS
        console.warn(
          `[geo] IP lookup failed ${consecutiveFailures} times in a row; ` +
            `pausing lookups for ${BREAKER_COOLDOWN_MS / 1000}s. State restrictions ` +
            "cannot be enforced from the IP path while this holds.",
        )
      }
      evictIfFull()
      cache.set(ip, { geo: null, expiresAt: Date.now() + NEGATIVE_TTL_MS })
      return null
    })
    .finally(() => {
      inFlight.delete(ip)
    })

  inFlight.set(ip, pending)
  return pending
}
