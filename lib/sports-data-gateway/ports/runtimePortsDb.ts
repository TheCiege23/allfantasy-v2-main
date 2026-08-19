import 'server-only'
/**
 * Fantasy OS Phase 5C — DB-backed runtime port classes (thin). Read certified snapshots via the repository,
 * then delegate to the pure assemblers. Fail closed: an unavailable repository yields empty data + an
 * `unavailable` context — never fabricated players/games.
 *
 * No games/stats/projections capability is certified yet, so game facts are `null` here → lock status is
 * `unknown` (auto-switch must fail closed) and projections/stats stay null. This is correct fail-closed behavior,
 * not a defect — the fields populate once those scopes are certified.
 */
import { DbCertifiedSnapshotRepository } from '../runtime/certifiedReads'
import {
  assembleLineupContext,
  assembleTradeContext,
  type CertifiedPlayerRecord,
  type LineupPlayerSportsContext,
  type TradeContextResult,
} from './runtimePorts'
import type { SportsDataContext } from '../contracts'

function toPlayerRecord(r: unknown): CertifiedPlayerRecord {
  const o = (r ?? {}) as Record<string, unknown>
  return {
    canonicalPlayerId: String(o.canonicalPlayerId ?? ''),
    displayName: String(o.displayName ?? ''),
    sport: String(o.sport ?? 'NFL'),
    positions: Array.isArray(o.positions) ? (o.positions as string[]) : [],
    teamId: (o.teamId as string | null) ?? null,
    injuryStatus: (o.injuryStatus as string | null) ?? null,
    active: o.active === true,
  }
}

export class LineupSportsRuntimePort {
  constructor(private repo = new DbCertifiedSnapshotRepository()) {}
  async getLineupAvailability(input: { sport: string; canonicalPlayerIds?: string[] }): Promise<{ data: LineupPlayerSportsContext[]; context: SportsDataContext }> {
    const snap = await this.repo.getLatestCertifiedSnapshot({ sport: input.sport, capability: 'players' })
    if (!snap.available) return { data: [], context: snap.context }
    const now = new Date()
    let players = snap.records.map(toPlayerRecord)
    if (input.canonicalPlayerIds?.length) {
      const wanted = new Set(input.canonicalPlayerIds)
      players = players.filter((p) => wanted.has(p.canonicalPlayerId))
    }
    // No certified games snapshot yet → game facts null → lock 'unknown' (fail closed).
    const data = players.map((player) => assembleLineupContext({ player, game: null, now, freshness: snap.context }))
    return { data, context: snap.context }
  }
}

export class TradeSportsRuntimePort {
  constructor(private repo = new DbCertifiedSnapshotRepository()) {}
  async getTradePlayerContext(canonicalPlayerIds: string[]): Promise<{ data: TradeContextResult[]; context: SportsDataContext }> {
    const snap = await this.repo.getLatestCertifiedSnapshot({ sport: 'NFL', capability: 'players' })
    if (!snap.available) return { data: [], context: snap.context }
    const byId = new Map(snap.records.map((r) => [String((r as { canonicalPlayerId?: string }).canonicalPlayerId ?? ''), toPlayerRecord(r)]))
    const data = canonicalPlayerIds.map((id) => {
      const player = byId.get(id)
      if (!player) return { resolved: false as const, reason: 'Insufficient Evidence' as const, dataContext: snap.context }
      return assembleTradeContext({ player, game: null, freshness: snap.context })
    })
    return { data, context: snap.context }
  }
}
