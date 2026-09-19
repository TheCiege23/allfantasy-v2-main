import { createHash } from 'node:crypto'
import { persistImmutableTransactionFacts } from '@/lib/league-import/bulkWarehouseFactPersistence'

export interface ProviderTransactionFactInput {
  provider: string
  upstreamTransactionId: string
  entryIndex: number
  leagueId: string
  sport: string
  type: string
  playerId?: string | null
  managerId?: string | null
  rosterId?: string | null
  payload: Record<string, unknown>
  season?: number | null
  weekOrPeriod?: number | null
  occurredAt?: Date
  /** Immutable observed state; a later state produces a new fact instead of overwriting this one. */
  lifecycleStage?: string | null
}

export function deterministicTransactionFactId(input: ProviderTransactionFactInput): string {
  const identity = [
    input.provider.toLowerCase(), input.leagueId, input.season ?? '', input.upstreamTransactionId,
    input.type, input.lifecycleStage ?? input.payload.status ?? '', input.playerId ?? '', input.rosterId ?? '', input.entryIndex,
  ].join('|')
  return `ptf_${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`
}

/** Incremental and idempotent: repeats are no-ops and never delete or rewrite unrelated history. */
export async function persistProviderTransactionFacts(rows: ProviderTransactionFactInput[]): Promise<number> {
  return persistImmutableTransactionFacts(rows.map((row) => {
    const transactionId = deterministicTransactionFactId(row)
    return {
      transactionId,
      leagueId: row.leagueId,
      sport: row.sport,
      type: row.type,
      playerId: row.playerId ?? null,
      managerId: row.managerId ?? null,
      rosterId: row.rosterId ?? null,
      payload: row.payload,
      season: row.season ?? null,
      weekOrPeriod: row.weekOrPeriod ?? null,
      createdAt: row.occurredAt,
    }
  }))
}
