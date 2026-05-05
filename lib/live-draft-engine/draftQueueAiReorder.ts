/**
 * AF Pro draft queue AI reorder — entitlement + `aiManageDraftQueueEnabled` policy.
 * Queue rows live on `DraftQueue.order` JSON; autopick reads that persisted order only.
 */

import { reorderQueueByNeedRespectingLocks } from '@/lib/draft-queue-engine'
import type { QueueEntry } from '@/lib/live-draft-engine/types'

export type DraftQueueAiReorderPlanMode =
  | 'persist'
  | 'suggestion_af_pro_required'
  | 'suggestion_ai_manage_disabled'

export type DraftQueueAiReorderPlan = {
  mode: DraftQueueAiReorderPlanMode
  /** Order to persist on `DraftQueue` when mode is `persist`; otherwise null. */
  persistOrder: QueueEntry[] | null
  /** Effective queue order shown as `reordered` in API responses (canonical manual order when not persisting). */
  displayOrder: QueueEntry[]
  /** Deterministic AI suggestion when not persisting; same as display when persisting. */
  suggestionOrder: QueueEntry[]
  explanation: string
  needByPosition?: Record<string, number>
}

function queueEntryFingerprint(entry: QueueEntry): string {
  const name = String(entry.playerName ?? '')
    .trim()
    .toLowerCase()
  const pos = String(entry.position ?? '')
    .trim()
    .toUpperCase()
  const pid = entry.playerId != null ? String(entry.playerId) : ''
  return `${name}|${pos}|${pid}`
}

/** Attach AI reorder audit fields for persisted queue rows. */
export function annotatePersistedAiQueueOrder(
  before: QueueEntry[],
  after: QueueEntry[],
  explanation: string
): QueueEntry[] {
  const rankBefore = new Map<string, number>()
  before.forEach((e, i) => {
    rankBefore.set(queueEntryFingerprint(e), i + 1)
  })
  const clippedReason = explanation.trim().slice(0, 280)

  return after.map((entry) => {
    const fp = queueEntryFingerprint(entry)
    const originalRank = rankBefore.get(fp) ?? null
    const locked = Boolean(entry.lockedByUser)
    return {
      ...entry,
      isAiAdjusted: !locked,
      aiOriginalRank: originalRank,
      aiReason: locked ? null : clippedReason,
    }
  })
}

/**
 * Pure planner for POST `/draft/queue/ai-reorder` — keeps route thin and unit-testable.
 */
export function planDraftQueueAiReorder(input: {
  queue: QueueEntry[]
  rosterPositions: string[]
  sport: string
  hasProDraftAiAccess: boolean
  aiManageDraftQueueEnabled: boolean
}): DraftQueueAiReorderPlan {
  const { queue, rosterPositions, sport, hasProDraftAiAccess, aiManageDraftQueueEnabled } = input

  const result = reorderQueueByNeedRespectingLocks({
    queue,
    rosterPositions,
    sport,
  })

  if (!hasProDraftAiAccess) {
    return {
      mode: 'suggestion_af_pro_required',
      persistOrder: null,
      displayOrder: queue,
      suggestionOrder: result.reordered,
      explanation: result.explanation,
      needByPosition: result.needByPosition,
    }
  }

  if (!aiManageDraftQueueEnabled) {
    return {
      mode: 'suggestion_ai_manage_disabled',
      persistOrder: null,
      displayOrder: queue,
      suggestionOrder: result.reordered,
      explanation: result.explanation,
      needByPosition: result.needByPosition,
    }
  }

  const persisted = annotatePersistedAiQueueOrder(queue, result.reordered, result.explanation)

  return {
    mode: 'persist',
    persistOrder: persisted,
    displayOrder: persisted,
    suggestionOrder: result.reordered,
    explanation: result.explanation,
    needByPosition: result.needByPosition,
  }
}

/** Used when entitlement/policy denies persist but we still want a labeled suggestion list. */
export function suggestionOnlyExplanation(base: string, reason: 'af_pro' | 'ai_manage_disabled'): string {
  if (reason === 'af_pro') {
    return `${base} (AF Pro required to save an AI-adjusted queue.)`
  }
  return `${base} Enable "AI manage draft queue" on your roster settings to save AI reorder.`
}
