/**
 * "Is this request hiding where it is, and with what?" — the one answer the
 * middleware VPN gate, /api/geo/vpn-status and the /vpn-blocked page share.
 *
 * Tor comes free from the edge header; everything else from the cached vendor
 * verdict in ./anonymizerCache. `blocked` is true only on a positive verdict:
 * like every geo check here, "nobody could tell" fails OPEN.
 */

import { clientIpFromHeaders } from "@/lib/http/clientIp"
import { resolveAnonymizerDetailByIp } from "./anonymizerCache"
import { isTorExit } from "./geoHeaders"
import type { AnonymizerKind } from "./geoIpParse"

export type { AnonymizerKind } from "./geoIpParse"

export interface VpnStatus {
  blocked: boolean
  kind: AnonymizerKind | null
}

const ANONYMIZER_KINDS: readonly AnonymizerKind[] = ["tor", "privacy_relay", "vpn", "proxy", "hosting"]

/** A `why=` query value, or anything else from a URL, narrowed to a known kind. */
export function asAnonymizerKind(value: unknown): AnonymizerKind | null {
  return typeof value === "string" && (ANONYMIZER_KINDS as readonly string[]).includes(value)
    ? (value as AnonymizerKind)
    : null
}

export async function vpnStatusFromHeaders(
  headers: Headers,
  opts: { fresh?: boolean } = {},
): Promise<VpnStatus> {
  if (isTorExit(headers)) return { blocked: true, kind: "tor" }
  const ip = clientIpFromHeaders(headers)
  if (!ip) return { blocked: false, kind: null }
  const detail = await resolveAnonymizerDetailByIp(ip, opts)
  return detail.anonymized === true ? { blocked: true, kind: detail.kind } : { blocked: false, kind: null }
}
