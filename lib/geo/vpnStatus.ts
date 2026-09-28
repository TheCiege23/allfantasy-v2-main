/**
 * "Is this request hiding where it is, and with what?" — the one answer the
 * middleware VPN gate, /api/geo/vpn-status and the /vpn-blocked page share.
 *
 * Tor comes free from the edge header; everything else from the cached vendor
 * verdict in ./anonymizerCache. `blocked` is true only on a positive verdict:
 * like every geo check here, "nobody could tell" fails OPEN.
 *
 * iCloud Private Relay is the one anonymizer that can still be PLACED: Apple
 * publishes the state each egress address stands for, and ./privateRelayRanges
 * holds the owner's rule for when that state is trusted. A placed relay user is
 * not blocked; `relayState` carries the state the gates should use instead of
 * the edge header, and `paidBlocked` keeps Mountain-time relay users off paid
 * features. Callers that pass no `relayRanges` loader get the old behaviour —
 * every relay user blocked.
 */

import { clientIpFromHeaders } from "@/lib/http/clientIp"
import { resolveAnonymizerDetailByIp } from "./anonymizerCache"
import { isTorExit } from "./geoHeaders"
import type { AnonymizerKind } from "./geoIpParse"
import { decideRelay, lookupRelayState, type RelayRangeSet } from "./privateRelayRanges"

export type { AnonymizerKind } from "./geoIpParse"

export interface VpnStatus {
  blocked: boolean
  kind: AnonymizerKind | null
  /**
   * For a Private Relay address Apple's feed lists: its US state. When
   * `blocked` is false this IS the request's state for every geo rule.
   */
  relayState?: string | null
  /** A placed relay user who must still be kept off paid features (Mountain time). */
  paidBlocked?: boolean
}

export type RelayRangesLoader = () => Promise<RelayRangeSet | null>

const ANONYMIZER_KINDS: readonly AnonymizerKind[] = ["tor", "privacy_relay", "vpn", "proxy", "hosting"]

/** A `why=` query value, or anything else from a URL, narrowed to a known kind. */
export function asAnonymizerKind(value: unknown): AnonymizerKind | null {
  return typeof value === "string" && (ANONYMIZER_KINDS as readonly string[]).includes(value)
    ? (value as AnonymizerKind)
    : null
}

export async function vpnStatusFromHeaders(
  headers: Headers,
  opts: { fresh?: boolean; relayRanges?: RelayRangesLoader } = {},
): Promise<VpnStatus> {
  if (isTorExit(headers)) return { blocked: true, kind: "tor" }
  const ip = clientIpFromHeaders(headers)
  if (!ip) return { blocked: false, kind: null }
  const detail = await resolveAnonymizerDetailByIp(ip, { fresh: opts.fresh })
  if (detail.anonymized !== true) return { blocked: false, kind: null }
  if (!opts.relayRanges) return { blocked: true, kind: detail.kind }

  // Any anonymized address Apple lists IS Private Relay, whatever a VPN vendor
  // called it; an address Apple does not list keeps the vendor's verdict.
  let set: RelayRangeSet | null = null
  try {
    set = await opts.relayRanges()
  } catch {
    set = null
  }
  const listedState = set ? lookupRelayState(set, ip) : null
  if (!listedState) return { blocked: true, kind: detail.kind }

  const decision = decideRelay(listedState)
  if (decision.kind === "placed") {
    return { blocked: false, kind: "privacy_relay", relayState: decision.state, paidBlocked: decision.paidBlocked }
  }
  return { blocked: true, kind: "privacy_relay", relayState: decision.state }
}
