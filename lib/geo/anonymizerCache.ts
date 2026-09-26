/**
 * A cached "is this client hiding where it is?" check, so the MIDDLEWARE gate
 * can refuse VPNs, proxies, data centres and privacy relays on every request
 * without a vendor call on every request.
 *
 * ⚠ WHY THIS EXISTS. Until 2026-09-24 the only VPN check was in paid checkout.
 * Every state gate reads the location of the IP a VPN replaces, so a Washington
 * user on any exit — Oregon, or Canada, which reads as "not US" and skips every
 * state rule — had the whole product, and a Hawaii user could use paid tools
 * they already held. The owner's rule since then: over a VPN, proxy, Tor or
 * iCloud Private Relay, only the public pages load (see middleware.ts).
 *
 * The shape is `./geoIpCache`'s, for the same reasons, and they are recorded
 * there: one call per unique IP per TTL, in-flight dedup (one page load is a
 * dozen parallel requests from one IP), a bounded Map, a circuit breaker, and a
 * latency budget because this sits in the request path.
 *
 * ⚠ IT FAILS OPEN, like every geo check in this repo. No key, a timeout, an
 * outage or an exhausted quota all yield `null`, and the gate lets `null`
 * through: a vendor outage must never take the product down. That is a
 * deliberate trade and it is logged, never silent — `parseProxycheckPayload`
 * says when the quota is exhausted, and this module says when no key is set.
 *
 * The rule for reading the vendors is `./geoIpParse`'s and nobody else's, so
 * the gate, /api/geo/check and checkout all answer the same way for one IP.
 */

import { fetchIpApi, fetchProxycheck } from "./geoIpFetch"
import { isPublicIp } from "./geoIpCache"
import { combineAnonymizerSignals, parseIpApiPayload, parseProxycheckPayload } from "./geoIpParse"

/**
 * A verdict about an address changes rarely. Kept at geoIpCache's TTL so the
 * call count tracks unique visitors, not requests. A user who turns their VPN
 * off gets a NEW address and a fresh check, so this never traps anyone.
 */
const ANSWERED_TTL_MS = 6 * 60 * 60 * 1000

/** "Could not tell" is retried soon, because it is far more likely transient. */
const UNKNOWN_TTL_MS = 5 * 60 * 1000

const MAX_ENTRIES = 10_000

/** One budget for both vendors together — this is user-visible latency, paid once per IP per TTL. */
const LOOKUP_TIMEOUT_MS = 1_200

const BREAKER_THRESHOLD = 5
const BREAKER_COOLDOWN_MS = 60 * 1000

interface Entry {
  verdict: boolean | null
  expiresAt: number
}

const cache = new Map<string, Entry>()
const inFlight = new Map<string, Promise<boolean | null>>()

let consecutiveUnknown = 0
let breakerOpenUntil = 0
let warnedNoKeys = false

/** Test seam. Nothing in production should need to reset this. */
export function __resetAnonymizerCache(): void {
  cache.clear()
  inFlight.clear()
  consecutiveUnknown = 0
  breakerOpenUntil = 0
  warnedNoKeys = false
}

export function anonymizerCacheStats(): { entries: number; inFlight: number; breakerOpen: boolean } {
  return { entries: cache.size, inFlight: inFlight.size, breakerOpen: Date.now() < breakerOpenUntil }
}

function evictIfFull(): void {
  if (cache.size < MAX_ENTRIES) return
  const oldest = cache.keys().next()
  if (!oldest.done) cache.delete(oldest.value)
}

function vendorKeys(): { proxycheckKey: string | undefined; ipapiKey: string | undefined } {
  return { proxycheckKey: process.env.PROXYCHECK_API_KEY?.trim() || undefined, ipapiKey: process.env.IPAPI_KEY?.trim() || undefined }
}

async function lookupUncached(ip: string): Promise<boolean | null> {
  const { proxycheckKey, ipapiKey } = vendorKeys()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS)
  try {
    // proxycheck first: it is the specialist. ipapi's hint is consulted only
    // when proxycheck did not already say yes — the same order detectUserState
    // uses, so the two spend the same calls and reach the same answer.
    const proxycheck = proxycheckKey
      ? parseProxycheckPayload(await fetchProxycheck(ip, proxycheckKey, controller.signal), ip)
      : null
    const ipapi =
      ipapiKey && !proxycheck?.anonymized ? parseIpApiPayload(await fetchIpApi(ip, ipapiKey, controller.signal)) : null
    return combineAnonymizerSignals({ tor: false, proxycheck, ipapi })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * `true` = anonymized, `false` = a vendor looked and found nothing, `null` =
 * nobody could tell. The middleware refuses only on `true`.
 */
export async function resolveAnonymizerByIp(ip: string): Promise<boolean | null> {
  if (!isPublicIp(ip)) return null

  // Checked before the cache and the breaker: with no key there is nothing to
  // ask, and counting that as a vendor failure would trip the breaker forever.
  const { proxycheckKey, ipapiKey } = vendorKeys()
  if (!proxycheckKey && !ipapiKey) {
    if (!warnedNoKeys) {
      warnedNoKeys = true
      console.warn(
        "[geo] Neither PROXYCHECK_API_KEY nor IPAPI_KEY is set, so the VPN gate can only " +
          "refuse Tor. VPNs, proxies and privacy relays pass. This is logged once per process.",
      )
    }
    return null
  }

  const now = Date.now()
  const hit = cache.get(ip)
  if (hit && hit.expiresAt > now) return hit.verdict

  if (now < breakerOpenUntil) return null

  const existing = inFlight.get(ip)
  if (existing) return existing

  const settle = (verdict: boolean | null): boolean | null => {
    if (verdict === null) {
      consecutiveUnknown += 1
      if (consecutiveUnknown >= BREAKER_THRESHOLD) {
        breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS
        console.warn(
          `[geo] VPN lookup could not answer ${consecutiveUnknown} times in a row; pausing lookups for ` +
            `${BREAKER_COOLDOWN_MS / 1000}s. The VPN gate fails open while this holds.`,
        )
        consecutiveUnknown = 0
      }
    } else {
      consecutiveUnknown = 0
    }
    evictIfFull()
    cache.set(ip, { verdict, expiresAt: Date.now() + (verdict === null ? UNKNOWN_TTL_MS : ANSWERED_TTL_MS) })
    return verdict
  }

  const pending = lookupUncached(ip)
    .then(settle, () => settle(null))
    .finally(() => {
      inFlight.delete(ip)
    })

  inFlight.set(ip, pending)
  return pending
}
