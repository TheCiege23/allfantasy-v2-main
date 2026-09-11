import { computeLeagueRankingsV2 } from "./league-rankings-v2"

export type V2RankingsResult = {
  leagueId: string
  leagueName: string
  season: string
  week: number
  phase: "offseason" | "in_season" | "post_draft" | "post_season"
  isDynasty: boolean
  isSuperFlex: boolean
  teams: any[]
  weeklyPointsDistribution: { rosterId: number; weeklyPoints: number[] }[]
  computedAt: number
  marketInsights: any[]
  ldiChips: any[]
  weeklyAwards: any | null
  tradeHubShortcuts: any[]
  partnerTendencies: any[]
  meta: {
    ldiByPos: Record<string, number>
    partnerPosCounts: Record<string, Record<string, number>>
    ldiSampleTotal: number
    ldiTrend: Record<string, number>
    proposalTargets: Array<{
      position: string
      rosterId: string
      name: string
      score: number
      ldiByPos: number
      meanPremiumPct: number
      nByPos: number
      label: "Overpayer" | "Learning"
    }>
  }
}

/**
 * Thrown when `computeLeagueRankingsV2` declines to produce rankings for a league.
 *
 * It returns `null` when `fetchLeagueSettings` cannot load the league — a Sleeper read that fails
 * for ordinary reasons: a deleted league, a renumbered id, a provider timeout. That is a normal
 * outcome for ONE league, not a reason to abandon a sweep, so this carries the league and week and
 * is safe for a batch caller to catch per league and continue.
 */
export class RankingsUnavailableError extends Error {
  constructor(
    readonly leagueId: string,
    readonly week: number,
  ) {
    super(`No V2 rankings for league ${leagueId} week ${week}: computeLeagueRankingsV2 returned null (league settings could not be loaded).`)
    this.name = "RankingsUnavailableError"
  }
}

/**
 * 🛑 THIS USED TO CAST THE NULL AWAY, AND EVERY CALLER DEREFERENCED IT IMMEDIATELY.
 *
 * `computeLeagueRankingsV2` returns `LeagueRankingsV2Output | null`; the old body was
 * `return (await …) as V2RankingsResult`, which silenced the `| null` so the compiler stopped
 * asking. All four callers — the snapshots handler, `computeDraftGrades`, the LDI heatmap and
 * `buildPartnerProfiles` — then read `v2.season` / `v2.phase` / `v2.meta` off it with no check,
 * so a null surfaced as `TypeError: Cannot read properties of null`, naming neither the league
 * nor the reason.
 *
 * ⚠ A USER HITS THAT RARELY AND A SWEEP HITS IT CONSTANTLY, which is why it is being fixed ahead
 * of any scheduled caller rather than alongside one: `rankings_snapshots` is empty in production
 * and the only writer is a membership-gated POST, so the first batch job over every league meets
 * this on the first league whose settings will not load.
 *
 * The remaining `as V2RankingsResult` is a SEPARATE, pre-existing structural assertion between the
 * engine's output type and this module's local shape. It is not the null cast and is deliberately
 * left alone — widening it is its own change with its own blast radius.
 */
export async function getV2Rankings(params: { leagueId: string; week: number }) {
  const result = await computeLeagueRankingsV2(params.leagueId, params.week)
  if (!result) throw new RankingsUnavailableError(params.leagueId, params.week)
  return result as V2RankingsResult
}

export function getPosTotalsFromPartnerCounts(meta: V2RankingsResult["meta"]) {
  const partnerPosCounts = meta?.partnerPosCounts ?? {}
  const totals: Record<string, number> = {}

  for (const partnerId of Object.keys(partnerPosCounts)) {
    const posMap = partnerPosCounts[partnerId] ?? {}
    for (const pos of Object.keys(posMap)) {
      totals[pos] = (totals[pos] ?? 0) + Number(posMap[pos] ?? 0)
    }
  }

  return totals
}
