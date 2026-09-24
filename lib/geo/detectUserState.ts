import { clientIpFromHeaders } from "@/lib/http/clientIp"

import type { GeoDetectionResult } from "./geoTypes"
import { isTorExit, resolveEdgeGeo } from "./geoHeaders"
import { fetchIpApi, fetchProxycheck } from "./geoIpFetch"
import {
  combineAnonymizerSignals,
  parseIpApiPayload,
  parseProxycheckPayload,
  UNREADABLE_IP_GEO,
} from "./geoIpParse"
import type { ParsedIpGeo, ProxycheckVerdict } from "./geoIpParse"

export { __resetIpApiShapeWarning } from "./geoIpParse"

export type { GeoDetectionResult } from "./geoTypes"

function getHeadersSource(input: Request | Headers): Headers {
  return input instanceof Headers ? input : input.headers
}

/**
 * ⚠ The VPN check asks about THIS address, so it must be the client's: a proxy
 * check on a Cloudflare hop is how a VPN gate ends up refusing every buyer. The
 * rule (cf-connecting-ip first) lives in lib/http/clientIp, shared with every
 * other IP-keyed decision.
 */
const extractClientIp = clientIpFromHeaders

/**
 * Optional VPN/proxy check via proxycheck.io when PROXYCHECK_API_KEY is set.
 * `null` when there is no key; an unanswered verdict on any failure (do not
 * block solely due to check failure). The reading itself is `./geoIpParse`'s,
 * shared with the middleware gate.
 */
async function proxycheckVerdict(ip: string): Promise<ProxycheckVerdict | null> {
  const key = process.env.PROXYCHECK_API_KEY?.trim()
  if (!key) return null
  return parseProxycheckPayload(await fetchProxycheck(ip, key), ip)
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

  // Tor is read from the edge header and costs nothing; everything else is the
  // same combined rule the middleware gate applies (./geoIpParse).
  let isVpnOrProxy = isTorExit(headers)
  if (!isVpnOrProxy && rawIp) {
    const proxycheck = await proxycheckVerdict(rawIp)
    // Reuse the response already in hand rather than calling twice; only ask
    // again when the geo branch above never ran, and not at all once proxycheck
    // has already said yes.
    const ipapi = proxycheck?.anonymized ? null : (lookup ?? (await ipapiLookup(rawIp)))
    isVpnOrProxy = combineAnonymizerSignals({ tor: false, proxycheck, ipapi }) === true
  }

  return {
    stateCode,
    country: placed.country,
    isVpnOrProxy,
    detectionSource: placed.detectionSource,
    rawIp,
  }
}
