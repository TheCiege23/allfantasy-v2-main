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
import {
  combineAnonymizerDetail,
  logAnonymizerBlock,
  parseIpApiPayload,
  parseProxycheckPayload,
  type AnonymizerDetail,
} from "./geoIpParse"

/**
 * A negative verdict changes rarely. Positive verdicts are retried sooner:
 * a network switch or a mistaken vendor result should not trap a visitor.
 */
const ANSWERED_TTL_MS = 6 * 60 * 60 * 1000
// Positive classifications can be transient or wrong after a network switch.
// Recheck them promptly so a home-screen app is not locked out for six hours.
const BLOCKED_TTL_MS = 2 * 60 * 1000

/** "Could not tell" is retried soon, because it is far more likely transient. */
const UNKNOWN_TTL_MS = 5 * 60 * 1000

const MAX_ENTRIES = 10_000

/** One budget for both vendors together — this is user-visible latency, paid once per IP per TTL. */
const LOOKUP_TIMEOUT_MS = 1_200

/**
 * A person pressing "I turned it off — try again" may skip a cached BLOCK, but
 * not more often than this per address: every forced recheck is a paid vendor
 * call, and the button is reachable by anyone on a VPN.
 */
const FORCED_RECHECK_MIN_INTERVAL_MS = 10 * 1000

const BREAKER_THRESHOLD = 5
const BREAKER_COOLDOWN_MS = 60 * 1000

interface Entry extends AnonymizerDetail {
  expiresAt: number
}

const UNKNOWN: AnonymizerDetail = { anonymized: null, kind: null }

const cache = new Map<string, Entry>()
const inFlight = new Map<string, Promise<AnonymizerDetail>>()
const lastForcedAt = new Map<string, number>()

let consecutiveUnknown = 0
let breakerOpenUntil = 0
let warnedNoKeys = false

/** Test seam. Nothing in production should need to reset this. */
export function __resetAnonymizerCache(): void {
  cache.clear()
  inFlight.clear()
  lastForcedAt.clear()
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

async function lookupUncached(ip: string): Promise<AnonymizerDetail> {
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
    const detail = combineAnonymizerDetail({ tor: false, proxycheck, ipapi })
    // Which vendor said yes, and in what words — never the address. See describeAnonymizerBlock.
    if (detail.anonymized === true) logAnonymizerBlock("middleware", detail, { proxycheck, ipapi })
    return detail
  } finally {
    clearTimeout(timer)
  }
}

/**
 * `true` = anonymized, `false` = a vendor looked and found nothing, `null` =
 * nobody could tell. The middleware refuses only on `true`.
 */
export async function resolveAnonymizerByIp(ip: string): Promise<boolean | null> {
  return (await resolveAnonymizerDetailByIp(ip)).anonymized
}

/**
 * `resolveAnonymizerByIp`, plus WHICH kind of anonymizer was seen, for the
 * block page and /api/geo/vpn-status.
 *
 * `fresh: true` is the "I turned it off — try again" path: a cached BLOCK for
 * this address is re-asked instead of replayed, at most once per
 * FORCED_RECHECK_MIN_INTERVAL_MS per address. A cached CLEAR is never re-asked —
 * it cannot trap anyone — and the circuit breaker still wins, so a vendor
 * outage is not hammered by people pressing a button.
 */
export async function resolveAnonymizerDetailByIp(
  ip: string,
  opts: { fresh?: boolean } = {},
): Promise<AnonymizerDetail> {
  if (!isPublicIp(ip)) return UNKNOWN

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
    return UNKNOWN
  }

  const now = Date.now()
  const hit = cache.get(ip)
  /** The cached block a forced re-check replaced, if any — to report a block that did not hold. */
  let forcedFrom: Entry | null = null
  if (hit && hit.expiresAt > now) {
    const mayForce =
      opts.fresh === true &&
      hit.anonymized !== false &&
      now - (lastForcedAt.get(ip) ?? 0) >= FORCED_RECHECK_MIN_INTERVAL_MS
    if (!mayForce) return { anonymized: hit.anonymized, kind: hit.kind, decidedBy: hit.decidedBy ?? null }
    lastForcedAt.set(ip, now)
    cache.delete(ip)
    forcedFrom = hit
  }

  if (now < breakerOpenUntil) return UNKNOWN

  const existing = inFlight.get(ip)
  if (existing) return existing

  const settle = (detail: AnonymizerDetail): AnonymizerDetail => {
    const verdict = detail.anonymized
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
    if (lastForcedAt.size >= MAX_ENTRIES) lastForcedAt.clear()
    cache.set(ip, {
      ...detail,
      expiresAt: Date.now() + (verdict === null ? UNKNOWN_TTL_MS : verdict ? BLOCKED_TTL_MS : ANSWERED_TTL_MS),
    })
    return detail
  }

  const pending = lookupUncached(ip)
    .then((detail) => {
      /*
       * ⚠ A BLOCK THAT CLEARS ON "TRY AGAIN" IS THE FALSE-POSITIVE SIGNATURE. A real VPN user who
       * presses the button without disconnecting stays blocked; a residential line a vendor
       * mislabelled for a few minutes clears. Say which vendor it was, so the pattern can be counted.
       */
      if (forcedFrom?.anonymized === true && detail.anonymized === false) {
        console.warn(
          `[geo] forced re-check cleared a block: was decidedBy=${forcedFrom.decidedBy ?? "unknown"} ` +
            `kind=${forcedFrom.kind ?? "unknown"}, now clear`,
        )
      }
      return settle(detail)
    }, () => settle(UNKNOWN))
    .finally(() => {
      inFlight.delete(ip)
    })

  inFlight.set(ip, pending)
  return pending
}
