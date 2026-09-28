/**
 * Apple's iCloud Private Relay egress feed, fetched — and NOTHING else.
 *
 * The same inverted split as ./geoIpFetch: the one live call lives here so the
 * module holding the logic (./privateRelayRanges) carries no provider URL. The
 * DB-first guard allowlists THIS FILE and watches the HOST, so a fetch of the
 * feed from anywhere else is still reported.
 *
 * ⚠ THE EXEMPTION IS CONDITIONAL on the importer set staying exactly one
 * ingestion module:
 *
 *     grep -rnE "privateRelayFetch" --include=*.ts --include=*.tsx .
 *
 * must show lib/geo/privateRelayIngest.ts and test files, and nothing else.
 * Check aliased, relative, dynamic and require forms — CLAUDE.md records four
 * censuses that missed a caller by checking one.
 *
 * The feed is public (no key, no token), documented by Apple at
 * https://developer.apple.com/support/prepare-your-network-for-icloud-private-relay/
 * and several megabytes, so it is fetched on a schedule, never per request.
 */

export const PRIVATE_RELAY_EGRESS_URL = "https://mask-api.icloud.com/egress-ip-ranges.csv"

/** The CSV text, or `null` on any failure. Never throws. */
export async function fetchPrivateRelayEgressCsv(signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(PRIVATE_RELAY_EGRESS_URL, { cache: "no-store", signal })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}
