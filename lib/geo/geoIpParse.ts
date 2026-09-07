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
  const vpnHint = org.includes("vpn") || org.includes("proxy") || org.includes("hosting")

  const country = asCountryCode(data.country_code) ?? asCountryCode(data.country)
  // `region` is the full name ("Washington") in most vendors' payloads and is
  // refused by asRegionCode; it is tried only so a payload that happens to put
  // the code there still works.
  const regionCode = asRegionCode(data.region_code) ?? asRegionCode(data.region)

  if (!country) {
    warnShapeOnce(Object.keys(data))
    return { country: null, regionCode: null, vpnHint, shapeUnrecognised: true }
  }

  return { country, regionCode, vpnHint, shapeUnrecognised: false }
}
