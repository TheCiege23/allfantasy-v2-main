import type { NormalizedTransaction } from '@/lib/league-import/types'
import type { FleaflickerTransactionsResponse } from './types'

const STATUS_PRIORITY: Record<string, number> = {
  TRADE_PROPOSED: 1,
  TRADE_TO_REVIEW: 2,
  TRADE_EXECUTION_DELAYED: 3,
  TRADE_ACCEPTED: 4,
  TRADE_ACCEPTED_FINAL: 5,
  TRADE_REJECTED_MESSAGE: 6,
  TRADE_REJECTED: 7,
  TRADE_CANCELLED: 7,
  TRADE_INVALIDATED: 8,
  TRADE_VETOED: 8,
}

function isoFromEpoch(value: string | number | null | undefined, fallback: string): string {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : fallback
}

/** Maps only explicit provider events; it never infers assets from roster differences. */
export function normalizeFleaflickerTransactions(
  raw: FleaflickerTransactionsResponse | null | undefined,
  importedAt: string,
): NormalizedTransaction[] {
  const byTrade = new Map<string, {
    status: string
    statusPriority: number
    createdAt: string
    adds: Record<string, string>
    rosterIds: Set<string>
    draftPicks: Array<{ season: number; round: number; toRosterId: string }>
    lifecycleEvents: Array<{ stage: string; occurred_at: string; team_id?: string | null; description?: string | null }>
  }>()

  for (const item of raw?.items ?? []) {
    const tradeId = item.trade?.tradeId ?? item.transaction?.tradeId
    if (tradeId == null) continue
    const key = String(tradeId)
    const eventType = String(item.trade?.type ?? '').trim() || 'TRADE_ACTIVITY'
    const priority = STATUS_PRIORITY[eventType] ?? 0
    const existing = byTrade.get(key) ?? {
      status: eventType,
      statusPriority: priority,
      createdAt: isoFromEpoch(item.timeEpochMilli, importedAt),
      adds: {},
      rosterIds: new Set<string>(),
      draftPicks: [],
      lifecycleEvents: [],
    }
    if (priority >= existing.statusPriority) {
      existing.status = eventType
      existing.statusPriority = priority
    }

    const tradeTeam = item.trade?.team?.id
    if (item.trade) {
      if (tradeTeam != null) existing.rosterIds.add(String(tradeTeam))
      if (!existing.lifecycleEvents.some((event) => event.stage === eventType)) existing.lifecycleEvents.push({
        stage: eventType,
        occurred_at: isoFromEpoch(item.timeEpochMilli, importedAt),
        team_id: tradeTeam == null ? null : String(tradeTeam),
        description: item.trade.description ?? null,
      })
    }
    const tx = item.transaction
    const teamId = tx?.team?.id
    if (teamId != null) {
      const rosterId = String(teamId)
      existing.rosterIds.add(rosterId)
      const playerId = tx?.player?.proPlayer?.id
      if (playerId != null) existing.adds[String(playerId)] = rosterId
      const season = tx?.draftPick?.season
      const round = tx?.draftPick?.round
      if (season != null && round != null) existing.draftPicks.push({ season, round, toRosterId: rosterId })
    }
    byTrade.set(key, existing)
  }

  return [...byTrade.entries()].map(([source_transaction_id, trade]) => ({
    source_transaction_id,
    type: 'trade',
    status: trade.status,
    created_at: trade.createdAt,
    adds: Object.keys(trade.adds).length ? trade.adds : undefined,
    roster_ids: [...trade.rosterIds],
    draft_picks: trade.draftPicks,
    lifecycle_events: trade.lifecycleEvents,
  }))
}
