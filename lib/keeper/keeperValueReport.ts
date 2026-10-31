import { prisma } from '@/lib/prisma'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { loadKeeperMarketRanks } from './keeperMarketValues'
import { keeperValue, type KeeperValue } from './missedDeadline'

/**
 * Keeper value report (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §4.3, AF Commissioner): each keeper
 * candidate's market value against the pick he would cost, shown to every manager on the keeper
 * screen before the deadline. The same measure the missed-deadline rule keeps by
 * (./missedDeadline `keeperValue`), so "best value" means one thing everywhere.
 *
 * The LEAGUE's plan decides — the commissioner's AF Commissioner — because the report is shared
 * with the whole league, not bought per manager.
 */

export type KeeperValueReport =
  | { available: true; values: Record<string, KeeperValue> }
  | { available: false; reason: 'not_entitled' | 'no_market_values' }

export async function keeperValueReport(
  leagueId: string,
  rows: ReadonlyArray<{ playerId: string; rosterId: string; projectedCostRound: number | null }>,
): Promise<KeeperValueReport> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { userId: true, sport: true, leagueSize: true, scoringPresetId: true, settings: true },
  })
  if (!league) return { available: false, reason: 'not_entitled' }
  const access = await new FeatureGateService().evaluateUserFeatureAccess(league.userId, 'commissioner_automation').catch(() => null)
  if (!access?.allowed) return { available: false, reason: 'not_entitled' }
  const rosterCount = new Set(rows.map((r) => r.rosterId)).size
  const rankOf = await loadKeeperMarketRanks(league, rosterCount)
  if (!rankOf) return { available: false, reason: 'no_market_values' }

  const players = await prisma.redraftRosterPlayer.findMany({
    where: { rosterId: { in: [...new Set(rows.map((r) => r.rosterId))] }, playerId: { in: rows.map((r) => r.playerId) } },
    select: { rosterId: true, playerId: true, playerName: true, position: true },
  })
  const byKey = new Map(players.map((p) => [`${p.rosterId}:${p.playerId}`, p]))
  const teams = league.leagueSize ?? rosterCount
  const values: Record<string, KeeperValue> = {}
  for (const r of rows) {
    const p = byKey.get(`${r.rosterId}:${r.playerId}`)
    const v = keeperValue(r.projectedCostRound, rankOf({ playerId: r.playerId, name: p?.playerName, position: p?.position }), teams)
    if (v) values[r.playerId] = v
  }
  return { available: true, values }
}
