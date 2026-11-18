/**
 * Who holds the draft picks that changed hands in a Fantrax trade-history export — for the rounds
 * Fantrax's API does not publish.
 *
 * 🛑 WHY THE EXPORT, WHEN THERE IS AN API. `getDraftPicks` lists future picks for rounds 1-4 only.
 * Measured 2026-11-18 on a 34-team dynasty league: 1,360 rows, ten seasons, none past round 4 —
 * while that league's own trade history showed a 2029 Round 5 pick changing hands. A later-round
 * pick trade is visible ONLY in the export.
 *
 * ⚠ THE API WINS WHEREVER IT SPEAKS. An export is a point in time and the API is current, so a
 * pick in a season-and-round the API lists is never taken from the export — otherwise an old
 * upload would overwrite a trade made since.
 *
 * ⚠ FUTURE DRAFTS ONLY. An export reaches back through drafts already held; a pick for the
 * league's current season or earlier is history, not an asset anybody owns.
 *
 * ⚠ THE LAST TRADE WINS, NOT THE LAST ROW. Fantrax exports newest first, so the trades are sorted
 * by their own timestamp before being applied: a pick traded A -> B and then B -> C must end on C
 * whichever way the file is ordered. A pick that ends back with its original team is reported as
 * returned, which is what clears a stale "traded" row for it.
 *
 * Pure: no database, no provider. Ids are the league's own team ids (`LeagueTeam.externalId`), as
 * the planned trade facts already carry them.
 */
import type { NormalizedTradeFact } from '@/lib/dynasty-import/types'
import type { NormalizedReturnedPick, NormalizedTradedPick } from '@/lib/league-import/types'

export function laterRoundPickOwnership(args: {
  facts: ReadonlyArray<Pick<NormalizedTradeFact, 'draftPicks' | 'created'>>
  /** `season:round` pairs the Fantrax API publishes for this league. Empty when none is on file. */
  publishedRounds: ReadonlySet<string>
  /** The league's current season; picks for it or earlier are skipped. Null = this calendar year. */
  afterSeason: number | null
}): { traded: NormalizedTradedPick[]; returned: NormalizedReturnedPick[] } {
  const afterSeason = args.afterSeason ?? new Date().getFullYear()
  const ordered = args.facts
    .map((fact, index) => ({ fact, index }))
    .sort((a, b) => a.fact.created - b.fact.created || b.index - a.index)

  const holders = new Map<string, { season: number; round: number; original: string; current: string }>()
  for (const { fact } of ordered) {
    for (const pick of fact.draftPicks ?? []) {
      const season = Number(pick.season)
      if (!Number.isFinite(season) || !(pick.round > 0) || !pick.rosterId || !pick.ownerId) continue
      holders.set(`${season}:${pick.round}:${pick.rosterId}`, {
        season,
        round: pick.round,
        original: pick.rosterId,
        current: pick.ownerId,
      })
    }
  }

  const traded: NormalizedTradedPick[] = []
  const returned: NormalizedReturnedPick[] = []
  for (const pick of holders.values()) {
    if (!(pick.season > afterSeason)) continue
    if (args.publishedRounds.has(`${pick.season}:${pick.round}`)) continue
    if (pick.original === pick.current) {
      returned.push({ season: pick.season, round: pick.round, original_roster_id: pick.original })
    } else {
      traded.push({
        season: pick.season,
        round: pick.round,
        original_roster_id: pick.original,
        current_owner_roster_id: pick.current,
      })
    }
  }
  return { traded, returned }
}
