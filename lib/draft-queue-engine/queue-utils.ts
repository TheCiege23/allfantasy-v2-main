import type { QueueEntry } from '@/lib/live-draft-engine/types'
import { trimDraftQueue } from '@/lib/draft-defaults/DraftQueueLimitResolver'

type RawQueueEntry = QueueEntry & {
  player_name?: string
  player_id?: string | null
  locked_by_user?: boolean
  lockedByUser?: boolean
  is_ai_adjusted?: boolean
  ai_original_rank?: number | null
  ai_reason?: string | null
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

export function normalizeQueueEntries(
  queue: unknown[],
  queueSizeLimit: number
): QueueEntry[] {
  const normalized = trimDraftQueue(queue, queueSizeLimit).map((e) => {
    const entry = (e ?? {}) as RawQueueEntry
    const lockedByUser = Boolean(
      entry.lockedByUser ??
        entry.locked_by_user ??
        (entry as { locked?: boolean }).locked
    )
    return {
      playerName: String(entry.playerName ?? entry.player_name ?? '').trim(),
      position: String(entry.position ?? '').trim(),
      team: entry.team ?? null,
      playerId: entry.playerId ?? entry.player_id ?? null,
      ...(lockedByUser ? { lockedByUser: true as const } : {}),
      ...(entry.isAiAdjusted === true || entry.is_ai_adjusted === true
        ? { isAiAdjusted: true as const }
        : {}),
      ...(entry.aiOriginalRank != null || entry.ai_original_rank != null
        ? {
            aiOriginalRank:
              (entry.aiOriginalRank ?? entry.ai_original_rank ?? null) as number | null,
          }
        : {}),
      ...(entry.aiReason != null || entry.ai_reason != null
        ? { aiReason: (entry.aiReason ?? entry.ai_reason ?? null) as string | null }
        : {}),
    }
  })

  return normalized.filter((entry) => entry.playerName.length > 0)
}

export function dedupeQueueEntries(queue: QueueEntry[]): QueueEntry[] {
  const seen = new Set<string>()
  const deduped: QueueEntry[] = []
  for (const entry of queue) {
    const key = `${normalizeName(entry.playerName)}|${String(entry.position ?? '').trim().toUpperCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(entry)
  }
  return deduped
}

export function removeDraftedPlayersFromQueue(
  queue: QueueEntry[],
  draftedNames: Set<string>
): { queue: QueueEntry[]; removedCount: number } {
  const filtered = queue.filter(
    (entry) => !draftedNames.has(normalizeName(entry.playerName))
  )
  return {
    queue: filtered,
    removedCount: Math.max(0, queue.length - filtered.length),
  }
}

export function normalizeDraftedNameSet(picks: Array<{ playerName: string }>): Set<string> {
  return new Set(
    picks
      .map((pick) => normalizeName(String(pick.playerName ?? '')))
      .filter(Boolean)
  )
}
