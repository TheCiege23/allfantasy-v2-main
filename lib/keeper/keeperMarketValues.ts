import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'

/**
 * Market ranks for a keeper league's players: FantasyCalc's redraft overall rank (1 = most
 * valuable), read DB-first. Shared by the missed-deadline rule (./missedDeadlineService) and the
 * keeper value report, so both price a player the same way.
 *
 * NFL only — FantasyCalc covers nothing else. `null` means "no market values for this league";
 * a lookup that returns null means "this player has no market price".
 */

export type MarketRankLookup = (player: { playerId: string; name: string | null | undefined; position: string | null | undefined }) => number | null

const keyOf = (name: string | null | undefined, position: string | null | undefined) =>
  `${normalizePlayerName(name)}|${String(position ?? '').trim().toUpperCase()}`

export async function loadKeeperMarketRanks(league: {
  sport?: string | null
  leagueSize?: number | null
  scoringPresetId?: string | null
  settings?: unknown
}, rosterCount: number): Promise<MarketRankLookup | null> {
  if (String(league.sport ?? 'NFL').toUpperCase() !== 'NFL') return null
  const settings = (league.settings as Record<string, unknown> | null) ?? {}
  const superflex = /superflex|\bsf\b|2qb/i.test(String(league.scoringPresetId ?? settings.scoring_preset_id ?? ''))
  const teams = league.leagueSize ?? rosterCount
  const chart = await getFantasyCalcValuesDbFirst({ isDynasty: false, numQbs: superflex ? 2 : 1, numTeams: Math.max(8, Math.min(16, teams)), ppr: 1 }).catch(() => [])
  if (!chart.length) return null
  const bySleeper = new Map<string, number>()
  const byName = new Map<string, number>()
  for (const p of chart) {
    if (p.player.sleeperId) bySleeper.set(String(p.player.sleeperId), p.overallRank)
    byName.set(keyOf(p.player.name, p.player.position), p.overallRank)
  }
  return (p) => bySleeper.get(p.playerId) ?? byName.get(keyOf(p.name, p.position)) ?? null
}
