import type { GeoDetectionResult } from "./geoTypes"
import { normaliseCountry, normaliseRegion, resolveEdgeGeo } from "./geoHeaders"
import { fetchIpApi, fetchProxycheck } from "./geoIpFetch"

export type { GeoDetectionResult } from "./geoTypes"

function getHeadersSource(input: Request | Headers): Headers {
  return input instanceof Headers ? input : input.headers
}

function extractClientIp(headers: Headers): string | null {
  const real = headers.get("x-real-ip")?.trim()
  if (real) return real
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  if (fwd) return fwd
  return null
}

/**
 * Optional VPN/proxy check via proxycheck.io when PROXYCHECK_API_KEY is set.
 * On any failure, returns false (do not block solely due to check failure).
 */
async function detectVpnOrProxy(ip: string | null): Promise<boolean> {
  if (!ip) return false
  const key = process.env.PROXYCHECK_API_KEY?.trim()
  if (!key) return false
  const data = await fetchProxycheck(ip, key)
  if (!data) return false
  const node = data[ip] as Record<string, unknown> | undefined
  if (!node || typeof node !== "object") return false
  const proxy = String(node.proxy ?? "").toLowerCase()
  const typ = String(node.type ?? "").toUpperCase()
  if (proxy === "yes") return true
  if (typ.includes("VPN")) return true
  return false
}

/**
 * A subdivision CODE, as opposed to a subdivision NAME.
 *
 * ⚠ This test is the whole reason the IP fallback is safe. An edge header sends
 * "WA"; an IP-geolocation vendor may send either "WA" or "Washington" depending
 * on which field you read, and `isFullyBlocked("WASHINGTON")` is FALSE. Letting
 * a name through would report a placed user as unrestricted — the exact silent
 * failure this whole path exists to end, reached from a new direction.
 *
 * So a value that is not code-shaped becomes `null` (honestly unknown) rather
 * than being passed on as if it were a code.
 */
const REGION_CODE = /^[A-Z0-9]{1,3}$/

function asRegionCode(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalised = normaliseRegion(value.trim() === "" ? null : value)
  if (!normalised) return null
  return REGION_CODE.test(normalised) ? normalised : null
}

function asCountryCode(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalised = normaliseCountry(value.trim() === "" ? null : value)
  if (!normalised) return null
  return /^[A-Z]{2}$/.test(normalised) ? normalised : null
}

export interface IpApiLookup {
  country: string | null
  regionCode: string | null
  vpnHint: boolean
  /** The call returned 200 but carried no field we could read a country from. */
  shapeUnrecognised: boolean
}

const IPAPI_LOOKUP_FAILED: IpApiLookup = {
  country: null,
  regionCode: null,
  vpnHint: false,
  shapeUnrecognised: false,
}

let warnedShape = false

/**
 * Say once, per process, that the vendor answered but we could not read it.
 *
 * A shape change and an unreachable vendor both end with "no country", and they
 * need different fixes — one is a code change, the other is an outage. Reporting
 * them identically is how the header outage stayed invisible for five days.
 */
function warnShapeOnce(keys: string[]): void {
  if (warnedShape) return
  warnedShape = true
  console.warn(
    "[geo] ipapi.co returned 200 but no readable country field. " +
      "State restrictions cannot be enforced from the IP fallback until the " +
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
 * One call to ipapi.co, read for BOTH location and the VPN hint.
 *
 * This used to read only `org`, for the VPN hint, and discard the rest of a
 * response that already carried the country and region. That was free data
 * being thrown away on every signup while the geo gates reported "unknown".
 *
 * ⚠ THE FIELD NAMES ARE READ DEFENSIVELY ON PURPOSE, and this is not laziness.
 * The vendor's response shape was NOT verifiable when this was written — the
 * documentation host is unreachable from the environment it was written in — so
 * rather than assert one spelling, it accepts the plausible ones and validates
 * what it finds. A value that does not look like a code is refused, and a 200
 * with nothing readable is reported loudly via `shapeUnrecognised` instead of
 * being returned as an ordinary "no data".
 *
 * Confirm against one real response and narrow this when you can:
 *     curl -s https://ipapi.co/8.8.8.8/json/
 * (no key required for a single lookup).
 */
async function ipapiLookup(ip: string): Promise<IpApiLookup> {
  const key = process.env.IPAPI_KEY?.trim()
  if (!key) return IPAPI_LOOKUP_FAILED

  const data = await fetchIpApi(ip, key)
  if (!data) return IPAPI_LOOKUP_FAILED
  if (data.error) return IPAPI_LOOKUP_FAILED

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

/**
 * Detects a user's US state from whichever edge is in front of us — Cloudflare
 * in production since 2026-09-02, Vercel on preview deployments — falling back
 * to an IP lookup when NO edge placed the request.
 *
 * The header reading lives in `./geoHeaders` rather than here, because
 * `middleware.ts` asks the same question and the two copies of it drifted apart
 * the moment the platform changed underneath them.
 *
 * ⚠ THE FALLBACK IS NOT A REPLACEMENT FOR THE EDGE HEADER, and must not be
 * treated as one. `middleware.ts` gates every request and is synchronous by
 * design, so it cannot make this call; only the async callers of this function
 * benefit. Measured on 2026-09-07, neither allfantasy.ai nor www.allfantasy.ai
 * was proxied through Cloudflare, so the header was absent on every request and
 * all three gates — page access, account creation and the VPN check — were
 * open. Proxying the hostname is the fix for the gate in middleware; this is
 * defence in depth for the gate that creates accounts.
 *
 * Optional VPN detection when PROXYCHECK_API_KEY / IPAPI_KEY are configured.
 */
export async function detectUserState(request: Request | Headers): Promise<GeoDetectionResult> {
  const headers = getHeadersSource(request)
  const edge = resolveEdgeGeo(headers)
  const rawIp = extractClientIp(headers)

  // Only reach for the network when no edge placed this request. With the
  // hostname proxied, this branch never runs and the path costs exactly what it
  // cost before.
  const needsIpGeo = edge.source === "unknown" && rawIp !== null
  const lookup = needsIpGeo ? await ipapiLookup(rawIp as string) : null

  const placed =
    edge.source !== "unknown"
      ? {
          country: edge.country,
          regionCode: edge.regionCode,
          detectionSource: (edge.source === "cloudflare"
            ? "cloudflare_headers"
            : "vercel_headers") as GeoDetectionResult["detectionSource"],
        }
      : lookup?.country
        ? {
            country: lookup.country,
            regionCode: lookup.regionCode,
            detectionSource: "ip_api" as const,
          }
        : {
            country: null,
            regionCode: null,
            detectionSource: "unknown" as const,
          }

  const stateCode = placed.country === "US" ? placed.regionCode : null

  let isVpnOrProxy = false
  if (rawIp) {
    isVpnOrProxy = await detectVpnOrProxy(rawIp)
    if (!isVpnOrProxy) {
      // Reuse the response already in hand rather than calling twice; only ask
      // again when the geo branch above never ran.
      isVpnOrProxy = lookup ? lookup.vpnHint : (await ipapiLookup(rawIp)).vpnHint
    }
  }

  return {
    stateCode,
    country: placed.country,
    isVpnOrProxy,
    detectionSource: placed.detectionSource,
    rawIp,
  }
}
