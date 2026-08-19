/**
 * Phase 2H — redraft lineup-save history writer.
 *
 * Mirrors lib/roster-lineup-engine/rosterMoveHistory.ts's (AfRosterMoveHistory)
 * hash-based dedup convention exactly, targeting the new RedraftRosterMoveHistory
 * table instead. See docs/DECISION_OS_MANAGER_DNA_PHASE2G_VOLUME_AND_LINEUP_HISTORY_SCOPE.md §2.
 *
 * A no-op save (before/after slot assignments hash identical) is skipped —
 * matching the existing Af-table convention of not logging non-changes.
 */
import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

function stableStringify(val: unknown): string {
  if (val === null || typeof val !== 'object') return JSON.stringify(val)
  if (Array.isArray(val)) return `[${val.map(stableStringify).join(',')}]`
  const o = val as Record<string, unknown>
  const keys = Object.keys(o).sort()
  return `{${keys.map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',')}}`
}

/** Same hashing scheme as hashPlayerDataSnapshot in the Af-table writer — kept local to avoid a cross-module dependency for one function. */
export function hashRosterSlotSnapshot(slotAssignments: unknown): string {
  return createHash('sha256').update(stableStringify(slotAssignments)).digest('hex').slice(0, 32)
}

export type RedraftRosterMoveSource = 'user' | 'commissioner' | 'system'

export interface RecordRedraftRosterMoveHistoryInput {
  leagueId: string
  rosterId: string
  seasonId: string
  season: number
  week: number
  actorUserId?: string | null
  source: RedraftRosterMoveSource
  /** Slot assignments (e.g. { [playerId]: slotType }) before the save. */
  beforeSlotAssignments: unknown
  /** Slot assignments after the save. */
  afterSlotAssignments: unknown
  metadata?: Prisma.InputJsonValue
}

/**
 * Write one RedraftRosterMoveHistory row for a real lineup save, skipping
 * genuine no-ops (identical before/after slot hash). Never throws by design —
 * callers (the live PATCH route) must not have lineup saves fail because
 * history-writing failed; see the try/catch at the call site in
 * app/api/redraft/roster/route.ts.
 */
export async function recordRedraftRosterMoveHistory(
  input: RecordRedraftRosterMoveHistoryInput,
): Promise<{ id: string | null; skipped: boolean }> {
  const beforeHash = hashRosterSlotSnapshot(input.beforeSlotAssignments)
  const afterHash = hashRosterSlotSnapshot(input.afterSlotAssignments)
  if (beforeHash === afterHash) {
    return { id: null, skipped: true }
  }

  const row = await prisma.redraftRosterMoveHistory.create({
    data: {
      leagueId: input.leagueId,
      rosterId: input.rosterId,
      seasonId: input.seasonId,
      season: input.season,
      week: input.week,
      actorUserId: input.actorUserId ?? null,
      source: input.source,
      moveSummary: 'redraft_lineup_slot_update',
      beforeHash,
      afterHash,
      metadata: input.metadata ?? undefined,
    },
  })
  return { id: row.id, skipped: false }
}
