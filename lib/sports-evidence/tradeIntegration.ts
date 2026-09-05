import 'server-only'
/**
 * Fantasy OS Phase 5E-f — shared certified Trade integration service (Workstream A).
 *
 * ONE server-only service for every wired Trade path (analysis detail, proposal, acceptance, settlement). It
 * COMPOSES the existing `CertifiedLineupIntegrationService` schedule primitive (`describeScheduleForPlayers`) —
 * it does NOT reimplement schedule/identity/lock logic, nor any trade rule (valuation, legality, ownership,
 * deadline, recently-added, cap, reconstruction, settlement). It supplies EVIDENCE only and NEVER grants
 * permission.
 *
 * IMPORTANT authority note: the resolved league trade settings declare `playerLockPolicy: 'individual_game_time'`
 * (see lib/league-trade-engine/tradeSettingsResolver.ts), but the trade engine does NOT enforce it anywhere (no
 * consumer reads it to block a trade). Per the Global Authority Rule, a player's game having started must not
 * automatically invalidate a trade unless the existing league rules already USE that state. So the reject-only
 * guard is structurally reject-CAPABLE but only fires when `enforcePlayerLock` is true — and the product routes
 * pass `enforcePlayerLock: false` because the engine does not enforce it. This avoids inventing a sports-data
 * trade rule while still re-evaluating certified evidence immediately before authoritative persistence.
 */
import { CertifiedLineupIntegrationService, type PlayerRef, type CertifiedScheduleDescription } from './lineupIntegration'

export type { PlayerRef, CertifiedScheduleDescription }

export const DECLARED_TRADE_LOCK_POLICY = 'individual_game_time (declared in resolveLeagueTradeSettings; not enforced by the trade engine)'

export type TradeSafety = {
  block: boolean
  reason: string
  freshnessStatus: string
  identityStatus: string
  /** Canonical ids of traded players whose game is (per current certified evidence) locked/started/final. Evidence, not a rejection. */
  startedPlayers: string[]
  snapshotVersion: string | null
  policyObserved: string
}

/** Extract canonical/provider player refs from persisted trade items (itemReference = player id for player assets). */
export function extractTradePlayerRefs(items: Array<{ itemType?: string | null; itemReference?: string | null }>): PlayerRef[] {
  const ids: string[] = []
  for (const it of items ?? []) {
    const type = String(it?.itemType ?? '').toLowerCase()
    if (type && !type.includes('player')) continue // picks / faab / other non-player assets carry no schedule
    const ref = it?.itemReference
    if (typeof ref === 'string' && ref.trim()) ids.push(ref.trim())
  }
  return dedupeRefs(ids)
}

function dedupeRefs(ids: string[]): PlayerRef[] {
  const seen = new Set<string>()
  const out: PlayerRef[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ canonicalPlayerId: id, providerSleeperId: /^\d+$/.test(id) ? id : null })
  }
  return out.slice(0, 60)
}

export class CertifiedTradeIntegrationService {
  constructor(private lineup = new CertifiedLineupIntegrationService()) {}

  /** Informational (never-blocking) certified schedule context for a set of traded players. */
  async describeTradeSportsContext(input: { season: string; week: string | null; players: PlayerRef[]; now?: Date }): Promise<CertifiedScheduleDescription> {
    return this.lineup.describeScheduleForPlayers(input)
  }

  private async evaluate(input: { season: string; week: string | null; players: PlayerRef[]; enforcePlayerLock: boolean; now?: Date }): Promise<TradeSafety> {
    if (input.players.length === 0) {
      return { block: false, reason: 'no resolvable player assets', freshnessStatus: 'unavailable', identityStatus: 'unresolved', startedPlayers: [], snapshotVersion: null, policyObserved: DECLARED_TRADE_LOCK_POLICY }
    }
    const desc = await this.lineup.describeScheduleForPlayers({ season: input.season, week: input.week, players: input.players, now: input.now })
    if (!desc.available) {
      return { block: false, reason: 'certified schedule unavailable — existing trade authority remains final', freshnessStatus: desc.freshnessStatus, identityStatus: desc.identityStatus, startedPlayers: [], snapshotVersion: null, policyObserved: DECLARED_TRADE_LOCK_POLICY }
    }
    const trustworthy = desc.freshnessStatus === 'current'
    const started = trustworthy ? desc.players.filter((p) => p.locked).map((p) => p.canonicalPlayerId) : []
    // reject-only AND only when the existing engine actually enforces individual_game_time (it does not today).
    const block = input.enforcePlayerLock && started.length > 0
    const reason = block
      ? `certified evidence: ${started.length} traded player(s) are in a locked/started game and the league enforces individual_game_time`
      : started.length > 0
        ? `${started.length} traded player(s) started, but the trade engine does not enforce individual_game_time — evidence only, not blocking`
        : trustworthy ? 'no certified lock condition for traded players' : `certified schedule ${desc.freshnessStatus} — not used to block`
    return { block, reason, freshnessStatus: desc.freshnessStatus, identityStatus: desc.identityStatus, startedPlayers: started, snapshotVersion: desc.snapshotVersion, policyObserved: DECLARED_TRADE_LOCK_POLICY }
  }

  /** Reject-only proposal safety. `enforcePlayerLock` reflects whether the existing engine enforces the lock policy. */
  async evaluateTradeProposalSafety(input: { season: string; week: string | null; players: PlayerRef[]; enforcePlayerLock: boolean; now?: Date }): Promise<TradeSafety> {
    return this.evaluate(input)
  }

  /** Reject-only settlement safety, re-evaluated immediately before authoritative persistence. */
  async evaluateTradeSettlementSafety(input: { season: string; week: string | null; players: PlayerRef[]; enforcePlayerLock: boolean; now?: Date }): Promise<TradeSafety> {
    return this.evaluate(input)
  }
}
