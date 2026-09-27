/**
 * Reading an IP-geolocation payload, and nothing else. Pure: no I/O, no state
 * beyond a once-per-process warning latch.
 *
 * ⚠ WHY THIS IS ITS OWN MODULE. Two callers need this rule — `detectUserState`
 * (signup, /api/geo/check) and `geoIpCache` (the middleware gate) — and a
 * second copy of it is the exact bug `geoHeaders` was created to remove one
 * layer up. If a vendor field spelling changes, it must change in one place.
 */

import { normaliseCountry, normaliseRegion } from "./geoHeaders"

export interface ParsedIpGeo {
  country: string | null
  regionCode: string | null
  vpnHint: boolean
  /** Part of `vpnHint`: the address is on a privacy-relay network (see isPrivacyRelayNetwork). */
  relayHint?: boolean
  /** The call returned a payload but carried no field we could read a country from. */
  shapeUnrecognised: boolean
}

export const UNREADABLE_IP_GEO: ParsedIpGeo = {
  country: null,
  regionCode: null,
  vpnHint: false,
  shapeUnrecognised: false,
}

/**
 * A subdivision CODE, as opposed to a subdivision NAME.
 *
 * ⚠ This test is the whole reason the IP path is safe. An edge header sends
 * "WA"; a geolocation vendor may send either "WA" or "Washington" depending on
 * which field you read, and `isFullyBlocked("WASHINGTON")` is FALSE. Letting a
 * name through would report a placed user as unrestricted — the silent failure
 * this entire path exists to end, reached from a new direction.
 */
const REGION_CODE = /^[A-Z0-9]{1,3}$/

export function asRegionCode(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalised = normaliseRegion(value.trim() === "" ? null : value)
  if (!normalised) return null
  return REGION_CODE.test(normalised) ? normalised : null
}

export function asCountryCode(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalised = normaliseCountry(value.trim() === "" ? null : value)
  if (!normalised) return null
  return /^[A-Z]{2}$/.test(normalised) ? normalised : null
}

let warnedShape = false

/**
 * Say once, per process, that the vendor answered but we could not read it.
 *
 * A shape change and an unreachable vendor both end with "no country", and they
 * need different fixes — one is a code change, the other is an outage.
 * Reporting them identically is how the header outage stayed invisible.
 */
function warnShapeOnce(keys: string[]): void {
  if (warnedShape) return
  warnedShape = true
  console.warn(
    "[geo] ipapi.co returned a payload with no readable country field. " +
      "State restrictions cannot be enforced from the IP path until the " +
      "response shape is re-read. Keys present: " +
      (keys.length > 0 ? keys.join(", ") : "(none)") +
      ". This is logged once per process.",
  )
}

/** Test seam. Nothing in production should need to reset this. */
export function __resetIpApiShapeWarning(): void {
  warnedShape = false
}

/**
 * Read an ipapi.co payload into a country, a region CODE and a VPN hint.
 *
 * ⚠ THE FIELD NAMES ARE READ DEFENSIVELY ON PURPOSE, and this is not laziness.
 * The vendor's response shape was NOT verifiable when this was written — the
 * documentation host is unreachable from the environment it was written in — so
 * rather than assert one spelling, it accepts the plausible ones and validates
 * what it finds. A value that does not look like a code is refused, and a
 * payload with nothing readable is reported loudly via `shapeUnrecognised`
 * instead of being returned as an ordinary "no data".
 *
 * Confirm against one real response and narrow this when you can:
 *     curl -s https://ipapi.co/8.8.8.8/json/
 * (no key required for a single lookup).
 */
export function parseIpApiPayload(data: Record<string, unknown> | null): ParsedIpGeo {
  if (!data) return UNREADABLE_IP_GEO
  if (data.error) return UNREADABLE_IP_GEO

  const org = String(data.org ?? "").toLowerCase()
  const relayHint = isPrivacyRelayNetwork(data.asn, data.org)
  const vpnHint = org.includes("vpn") || org.includes("proxy") || org.includes("hosting") || relayHint

  const country = asCountryCode(data.country_code) ?? asCountryCode(data.country)
  // `region` is the full name ("Washington") in most vendors' payloads and is
  // refused by asRegionCode; it is tried only so a payload that happens to put
  // the code there still works.
  const regionCode = asRegionCode(data.region_code) ?? asRegionCode(data.region)

  if (!country) {
    warnShapeOnce(Object.keys(data))
    return { country: null, regionCode: null, vpnHint, relayHint, shapeUnrecognised: true }
  }

  return { country, regionCode, vpnHint, relayHint, shapeUnrecognised: false }
}

/**
 * Networks that carry privacy-relay traffic and never a subscriber's own line.
 *
 * iCloud Private Relay leaves Apple's network through Akamai (AS36183),
 * Cloudflare (AS13335) and Fastly (AS54113); Cloudflare WARP leaves through
 * AS13335 too. An end user's connection is never ADDRESSED from a CDN's
 * network, so a client IP there is a relay, whatever a VPN list says about it.
 *
 * ⚠ The client IP must be `cf-connecting-ip`. Cloudflare's own hop sits in
 * AS13335 as well, so reading the wrong header would flag every visitor —
 * the exact failure `lib/http/clientIp` exists to prevent.
 *
 * Owner's decision, 2026-09-24: Private Relay is treated like a VPN. It keeps
 * the user's region by default, but a user who picks "country and time zone"
 * can surface in a neighbouring state, and the gate cannot tell which setting
 * produced an address.
 */
const PRIVACY_RELAY_ASNS = new Set(["13335", "36183", "54113"])
const PRIVACY_RELAY_ORGS = ["cloudflare", "akamai", "fastly"]

export function isPrivacyRelayNetwork(asn: unknown, org: unknown): boolean {
  const asnDigits = String(asn ?? "").trim().toUpperCase().replace(/^AS/, "")
  if (PRIVACY_RELAY_ASNS.has(asnDigits)) return true
  const name = String(org ?? "").toLowerCase()
  return PRIVACY_RELAY_ORGS.some((o) => name.includes(o))
}

export interface ProxycheckVerdict {
  /** The vendor answered about this IP. False on a denial, an error or an unreadable payload. */
  answered: boolean
  anonymized: boolean
  /** Part of `anonymized`: the address is on a privacy-relay network (see isPrivacyRelayNetwork). */
  relay?: boolean
  /** Top-level `status: "denied"` — quota exhausted or key refused. Every answer is "unknown" while it holds. */
  denied: boolean
}

const PROXYCHECK_UNANSWERED: ProxycheckVerdict = { answered: false, anonymized: false, denied: false }

/**
 * proxycheck.io `type` values that mean the address cannot place a person.
 * `HOSTING` is a data centre: a VPN the vendor has not catalogued yet usually
 * lands here, and a residence never does. The ipapi hint already counted
 * "hosting" before this existed, so this keeps the two vendors on one rule.
 */
const ANONYMIZING_TYPES = ["VPN", "TOR", "HOSTING"]

let warnedDenied = false

function warnDeniedOnce(): void {
  if (warnedDenied) return
  warnedDenied = true
  // ⚠ Status only. The vendor's message is not logged: the key rides in the
  // request's query string, and a message that echoes it would leak it.
  console.warn(
    "[geo] proxycheck.io refused the lookup (status: denied — quota exhausted or key rejected). " +
      "VPN detection fails OPEN while this holds, so the VPN gate is not enforcing. " +
      "This is logged once per process.",
  )
}

/** Test seam. Nothing in production should need to reset this. */
export function __resetProxycheckDeniedWarning(): void {
  warnedDenied = false
}

/**
 * Read a proxycheck.io v2 payload (`&vpn=1&asn=1`) for one IP.
 *
 * ONE reading for both callers — `detectUserState` (signup, /api/geo/check,
 * checkout) and `anonymizerCache` (the middleware gate) — for the reason this
 * module exists at all: two copies of a vendor rule drift, and a gate and the
 * API that explains it must not disagree about the same address.
 */
export function parseProxycheckPayload(data: Record<string, unknown> | null, ip: string): ProxycheckVerdict {
  if (!data) return PROXYCHECK_UNANSWERED
  const status = String(data.status ?? "").toLowerCase()
  if (status === "denied") {
    warnDeniedOnce()
    return { answered: false, anonymized: false, denied: true }
  }
  if (status === "error") return PROXYCHECK_UNANSWERED

  const node = data[ip]
  if (!node || typeof node !== "object") return PROXYCHECK_UNANSWERED
  const entry = node as Record<string, unknown>

  const proxy = String(entry.proxy ?? "").toLowerCase()
  const type = String(entry.type ?? "").toUpperCase()
  const relay = isPrivacyRelayNetwork(entry.asn, entry.provider ?? entry.organisation)
  const anonymized = proxy === "yes" || ANONYMIZING_TYPES.some((t) => type.includes(t)) || relay
  return { answered: true, anonymized, relay, denied: false }
}

/**
 * The one rule for "is this client hiding where it is": Tor, a proxy or VPN, a
 * data centre, or a privacy relay. `true` when any signal says so, `false` when
 * a vendor answered and none did, `null` when nothing could answer.
 *
 * ⚠ `null` is NOT "clean", and callers must not cache or report it as such.
 * The gate fails open on it — deliberately, because a vendor outage must not
 * take the product down — but it is an absence of evidence, not evidence.
 */
export function combineAnonymizerSignals(s: {
  tor: boolean
  proxycheck: ProxycheckVerdict | null
  ipapi: ParsedIpGeo | null
}): boolean | null {
  if (s.tor) return true
  if (s.proxycheck?.anonymized) return true
  if (s.ipapi?.vpnHint) return true
  if (s.proxycheck?.answered) return false
  if (s.ipapi && (s.ipapi.country !== null || s.ipapi.shapeUnrecognised)) return false
  return null
}

/** Why an address counts as hidden — only ever asked of a `true` from combineAnonymizerSignals. */
export type AnonymizerKind = "tor" | "relay" | "vpn"

/**
 * The reason behind a `true` from combineAnonymizerSignals, so the block page can
 * name the one thing to switch off.
 *
 * ⚠ WHY "relay" WINS OVER A VPN FLAG. iCloud Private Relay is on by default for
 * iCloud+ subscribers, and a person who has just switched their VPN app off does
 * not know Safari has a second, separate privacy setting. The owner hit exactly
 * that on 2026-09-25: VPN off, still blocked, from a Fastly relay address. A relay
 * network is the more specific and more actionable answer, so it is reported
 * even when a vendor also lists the address as a VPN.
 *
 * Presentation only: the gate still refuses on combineAnonymizerSignals alone.
 */
export function anonymizerKindOf(s: {
  tor: boolean
  proxycheck: ProxycheckVerdict | null
  ipapi: ParsedIpGeo | null
}): AnonymizerKind | null {
  if (combineAnonymizerSignals(s) !== true) return null
  if (s.tor) return "tor"
  if (s.proxycheck?.relay || s.ipapi?.relayHint) return "relay"
  return "vpn"
}
