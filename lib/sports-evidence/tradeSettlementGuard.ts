import 'server-only'
/**
 * Fantasy OS Phase 5E-f — shared settlement-guard helper for the Trade acceptance + settlement routes.
 *
 * Loads the persisted trade + league, extracts the traded players, and runs the reject-only certified
 * settlement guard. Reused by BOTH the accept and process routes so the reject-only logic lives in exactly one
 * place. Gated by the `trade` sports-data flag; fails OPEN on any error (the existing settlement authority
 * remains final). enforcePlayerLock is FALSE — the trade engine does not enforce the declared
 * individual_game_time policy, so this never invents a rejection.
 */
import { prisma } from '@/lib/prisma'
import { getAfLeagueTrade } from '@/lib/league-trade-engine/tradeService'
import { isSportsDataEnabled } from './gates'
import { CertifiedTradeIntegrationService, extractTradePlayerRefs, type TradeSafety } from './tradeIntegration'
import { weekFromLeagueSettingsForLineup } from '@/lib/roster/buildPersistedRosterDataFromRosterState'

export type TradeSettlementSportsDecision = {
  featureGateEnabled: boolean
  leagueId: string
  tradeId: string
  finalDecision: 'allowed' | 'rejected'
  reason: string
  freshnessStatus: string
  identityStatus: string
  scheduleSnapshotVersion: string | null
  startedCanonicalPlayerIds: string[]
  policyObserved: string
  evaluatedAt: string
}

/**
 * Re-evaluate certified evidence immediately before authoritative trade persistence. Returns `block:false`
 * when the gate is off, sport is non-NFL, or any error occurs (existing authority final). Never throws.
 */
export async function evaluateTradeSettlementGuard(leagueId: string, tradeId: string): Promise<{ block: boolean; decision?: TradeSettlementSportsDecision; reason?: string }> {
  if (!isSportsDataEnabled('trade')) return { block: false }
  try {
    const [trade, league] = await Promise.all([
      getAfLeagueTrade(leagueId, tradeId),
      prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true, settings: true } }),
    ])
    if (!trade || !league || String(league.sport ?? 'NFL').toUpperCase() !== 'NFL') return { block: false }
    const refs = extractTradePlayerRefs((trade.items ?? []).map((i) => ({ itemType: i.itemType, itemReference: i.itemReference })))
    const guard: TradeSafety = await new CertifiedTradeIntegrationService().evaluateTradeSettlementSafety({
      season: String(league.season ?? new Date().getFullYear()),
      week: String(weekFromLeagueSettingsForLineup(league.settings)),
      players: refs,
      enforcePlayerLock: false,
    })
    const decision: TradeSettlementSportsDecision = {
      featureGateEnabled: true,
      leagueId,
      tradeId,
      finalDecision: guard.block ? 'rejected' : 'allowed',
      reason: guard.reason,
      freshnessStatus: guard.freshnessStatus,
      identityStatus: guard.identityStatus,
      scheduleSnapshotVersion: guard.snapshotVersion,
      startedCanonicalPlayerIds: guard.startedPlayers,
      policyObserved: guard.policyObserved,
      evaluatedAt: new Date().toISOString(),
    }
    return { block: guard.block, decision, reason: guard.block ? guard.reason : undefined }
  } catch {
    return { block: false }
  }
}
