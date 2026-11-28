import type { MarketValuesPayload } from '@/lib/trade-intel/marketValueService'
import type { LeagueTradeChart } from './leagueTradePricing'

/** What `valuesSource` says for a plan priced on this. */
export const LEAGUE_CHART_SOURCE = 'this league’s AllFantasy trade chart'

/**
 * The PER-LEAGUE player price the one trade grader prices on, in the shape the player-value readers
 * (`toDiscoveryPlayers`, `faabPoolFor`, `playerValueForLeague`) already take (2026-11-26).
 *
 * `createLeagueTradeGrader` resolves this league's chart once (`resolveLeagueTradeChart`: the league's
 * own dynasty/redraft × QBs × teams × PPR board). A Chimmy tool that needs a player's VALUE rather than
 * a deal's grade reads it from that same chart, so its numbers and every trade letter in the app are
 * one price — not `marketValueService`'s separately-requested FantasyCalc board.
 *
 * PURE. Picks are not carried (their price is the grader's pick curve, applied per deal); FAAB has no
 * market anchor here, so `faab.anchorValue` is null and nothing converts value points to dollars from it.
 * Null when the chart holds no priced player, so a caller refuses rather than price everyone at nothing.
 */
export function marketValuesFromLeagueChart(chart: Pick<LeagueTradeChart, 'fcPlayers' | 'fcSyncedAt' | 'chartIsDynasty' | 'isSuperFlex' | 'leagueSize' | 'pprNfl'>): MarketValuesPayload | null {
  const bySleeperId: MarketValuesPayload['bySleeperId'] = {}
  for (const row of chart.fcPlayers ?? []) {
    const id = row?.player?.sleeperId?.trim()
    const position = row?.player?.position ?? null
    if (!id || String(position).toUpperCase() === 'PICK') continue
    if (!(typeof row.value === 'number' && Number.isFinite(row.value) && row.value >= 0)) continue
    bySleeperId[id] = {
      name: row.player.name,
      sleeperId: id,
      position,
      value: row.value,
      overallRank: Number.isFinite(row.overallRank) ? row.overallRank : null,
      trend30Day: Number.isFinite(row.trend30Day) ? row.trend30Day : null,
    }
  }
  if (Object.keys(bySleeperId).length === 0) return null
  return {
    version: 1,
    fetchedAt: chart.fcSyncedAt ?? new Date().toISOString(),
    source: LEAGUE_CHART_SOURCE,
    mode: chart.chartIsDynasty ? 'dynasty' : 'redraft',
    bestBallNote: null,
    numQbs: chart.isSuperFlex ? 2 : 1,
    numTeams: chart.leagueSize,
    ppr: chart.pprNfl,
    bySleeperId,
    pickBySlot: {},
    pickByRound: {},
    faab: { anchorRank: 0, anchorValue: null, formula: '' },
  }
}
