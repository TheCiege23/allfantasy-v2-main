import type { GeoDetectionResult } from "./geoTypes"
import { resolveEdgeGeo } from "./geoHeaders"
import { fetchIpApi, fetchProxycheck } from "./geoIpFetch"
import { parseIpApiPayload, UNREADABLE_IP_GEO } from "./geoIpParse"
import type { ParsedIpGeo } from "./geoIpParse"

export { __resetIpApiShapeWarning } from "./geoIpParse"

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
 * One call to ipapi.co, read for BOTH location and the VPN hint.
 *
 * This used to read only `org`, for the VPN hint, and discard the rest of a
 * response that already carried the country and region. That was free data
 * being thrown away on every signup while the geo gates reported "unknown".
 *
 * The reading itself lives in `./geoIpParse` because the middleware cache needs
 * the identical rule, and a second copy of it here is the bug `geoHeaders` was
 * created to remove one layer up.
 */
async function ipapiLookup(ip: string): Promise<ParsedIpGeo> {
  const key = process.env.IPAPI_KEY?.trim()
  if (!key) return UNREADABLE_IP_GEO
  return parseIpApiPayload(await fetchIpApi(ip, key))
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
 * treated as one. Measured on 2026-09-07, neither allfantasy.ai nor
 * www.allfantasy.ai was proxied through Cloudflare, so the header was absent on
 * every request and all three gates — page access, account creation and the VPN
 * check — were open. Proxying the hostname is the exact fix; this is defence in
 * depth, and it fails open by design.
 *
 * ⚠ THIS FUNCTION IS NOT THE ONE MIDDLEWARE USES. The gate in `middleware.ts`
 * runs on nearly every request and cannot afford an uncached lookup or the
 * proxycheck call below, so it goes through `./geoIpCache` instead. Both read a
 * vendor payload through the SAME `./geoIpParse`, which is what keeps the gate
 * and this function answering alike — they were two copies once, and drifting
 * apart is how the 2026-09-02 outage went unnoticed.
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
