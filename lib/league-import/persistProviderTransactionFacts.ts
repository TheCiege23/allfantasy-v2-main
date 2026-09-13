import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

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
  await Promise.all(rows.map((row) => {
    const transactionId = deterministicTransactionFactId(row)
    const data = {
      leagueId: row.leagueId,
      sport: row.sport,
      type: row.type,
      playerId: row.playerId ?? null,
      managerId: row.managerId ?? null,
      rosterId: row.rosterId ?? null,
      payload: row.payload as Prisma.InputJsonValue,
      season: row.season ?? null,
      weekOrPeriod: row.weekOrPeriod ?? null,
    }
    return prisma.transactionFact.upsert({
      where: { transactionId },
      create: { transactionId, ...data, createdAt: row.occurredAt ?? undefined },
      // A fact is an immutable observation. Replaying the same provider page is
      // a no-op; a changed lifecycle stage has a different deterministic key.
      update: {},
    })
  }))
  return rows.length
}
