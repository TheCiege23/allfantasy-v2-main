/**
 * Universal League Hub — is THIS league re-readable from its provider?
 *
 * 🛑 A PER-LEAGUE QUESTION THAT THE HUB WAS ANSWERING PER-PROVIDER, AND FANTRAX IS WHY IT MATTERS.
 * `deriveImportType` used to hardcode `fantrax → csv_snapshot`. That was true when Fantrax could
 * only be imported from an uploaded CSV, and it is now true of only SOME Fantrax leagues:
 *
 *   FantraxLeague.sourceLeagueId set   → the live `fxea` API can be re-read; the scheduled
 *                                        refresh does exactly that
 *   FantraxLeague.sourceLeagueId null  → a CSV-era row. The schema says it plainly: "a null here
 *                                        means 'snapshot only, not refreshable', which is a real
 *                                        state rather than missing data" — and such a row can
 *                                        never acquire one.
 *
 * ⚠ THE LABEL IS NOT COSMETIC; IT GATES WHAT THE PRODUCT WILL SAY ABOUT A PERSON.
 * `commissionerOsContext` turns `csv_snapshot` into `isSnapshotOnly`, which suppresses integrity
 * recommendations outright and filters out `manager_engagement_risk`. The reasoning is sound and
 * must survive this change: one snapshot proves a lineup was empty AT THE MOMENT OF UPLOAD, never
 * that a manager is abandoning the league. So a genuinely frozen snapshot must keep that
 * suppression, and only a league that is really being re-read may lose it.
 *
 * Getting that backwards in either direction is a real cost — suppress a refreshable league and
 * its commissioner never hears about an inactive manager; un-suppress a frozen one and the product
 * accuses someone of abandonment on the strength of a single upload from months ago.
 *
 * ⚠ RESOLVED BY CANONICAL `League.id`, NOT BY THE DASHBOARD ROW'S ID. The league list mixes three
 * id spaces, so taking whatever id a row happens to carry is how the wrong league gets answered
 * for. Callers pass canonical ids; this maps them itself.
 */
import { prisma } from '@/lib/prisma'

/**
 * Canonical `League.id` → whether that league can be re-read from a live provider source.
 *
 * Only Fantrax leagues appear in the map. Every other provider's refreshability is a property of
 * the provider rather than the league (see `deriveImportType`), so an absent entry means "ask the
 * provider", never "not refreshable".
 */
export async function resolveFantraxRefreshability(
  canonicalLeagueIds: readonly string[],
): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>()
  const ids = [...new Set(canonicalLeagueIds.filter((id) => typeof id === 'string' && id.trim()))]
  if (ids.length === 0) return out

  /*
   * Two narrow reads, and only when a Fantrax league is actually present. The first is filtered on
   * `platform` so a portfolio with no Fantrax leagues costs one indexed query returning nothing,
   * and the second is skipped entirely.
   */
  const fantraxLeagues = await prisma.league
    .findMany({
      where: { id: { in: ids }, platform: 'fantrax' },
      select: { id: true, platformLeagueId: true },
    })
    .catch(() => [])

  if (fantraxLeagues.length === 0) return out

  /*
   * ⚠ `League.platformLeagueId` FOR A FANTRAX LEAGUE IS THE `FantraxLeague` ROW'S UUID — not
   * Fantrax's own league id. The schema says so on `sourceLeagueId`, and it is the reason that
   * column had to exist at all: without it a refresh had nothing to re-fetch with.
   */
  const snapshotIds = fantraxLeagues
    .map((l) => l.platformLeagueId)
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)

  const snapshots = snapshotIds.length
    ? await prisma.fantraxLeague
        .findMany({ where: { id: { in: snapshotIds } }, select: { id: true, sourceLeagueId: true } })
        .catch(() => [])
    : []

  const refreshableBySnapshotId = new Map<string, boolean>()
  for (const s of snapshots) {
    refreshableBySnapshotId.set(s.id, typeof s.sourceLeagueId === 'string' && s.sourceLeagueId.trim().length > 0)
  }

  for (const league of fantraxLeagues) {
    /*
     * A Fantrax league whose snapshot row we cannot find resolves to NOT refreshable. That is the
     * conservative direction on purpose: it keeps the suppression on, so the failure mode of a
     * missing row is "we stay quiet about this manager" rather than "we accuse them".
     */
    const snapshotId = league.platformLeagueId
    out.set(league.id, snapshotId ? (refreshableBySnapshotId.get(snapshotId) ?? false) : false)
  }

  return out
}
