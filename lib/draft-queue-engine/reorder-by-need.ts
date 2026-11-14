/**
 * Reorder draft queue by roster need and availability.
 *
 * ⚠ NEED COMES FROM THE DRAFT ENGINE (2026-11-14). This file used to carry its own position-weight
 * table (QB 90, RB 85, …) and its own count-down curve, so "reorder my queue by need" could disagree
 * with the draft room's own recommendation about what the roster needs — a superflex league's second
 * QB, an IDP league's linebackers, a roster with three FLEX slots. It now asks
 * `computeNeeds` (lib/draft-helper/RecommendationEngine.ts), the same need model behind
 * /api/draft/recommend and the Decision OS `manager.draft.pick` decision, given the league's real
 * roster slots and superflex/2QB flags when the caller has them. Without slots the engine uses its
 * per-sport default targets, which cover all seven sports.
 */

import type { QueueEntry } from '@/lib/live-draft-engine/types'
import { computeNeeds, normalizeDraftSlot, type RecommendationPlayer } from '@/lib/draft-helper/RecommendationEngine'

/** A position the engine has no target for (not on this sport's roster) sorts below every real need. */
const NO_TARGET_NEED = 0

interface ReorderQueueInput {
  queue: QueueEntry[]
  /** Current user's roster (positions already drafted) */
  rosterPositions: string[]
  sport: string
  /** The league's starting slots (e.g. ['QB','RB','RB','WR','WR','TE','FLEX','SUPER_FLEX']). */
  rosterSlots?: string[]
  isSF?: boolean
  is2QB?: boolean
  /** Optional set of available names (trimmed lowercase). Unavailable entries are dropped before reorder. */
  availableNames?: Set<string>
  /** Optional: generate short explanation via AI */
  generateExplanation?: boolean
}

interface ReorderQueueResult {
  reordered: QueueEntry[]
  explanation: string
  /** Position need scores used for ordering */
  needByPosition?: Record<string, number>
}

function engineNeeds(input: ReorderQueueInput, queue: QueueEntry[]): Record<string, number> {
  const available: RecommendationPlayer[] = queue.map((e) => ({
    name: e.playerName ?? '',
    position: e.position ?? '',
    team: e.team ?? null,
  }))
  return computeNeeds(
    input.rosterPositions.map((position) => ({ position })),
    input.rosterSlots ?? [],
    Boolean(input.isSF),
    available,
    input.sport,
    Boolean(input.is2QB),
  )
}

/**
 * Reorder queue: higher need positions first, then by position weight.
 * Preserves all entries; only order changes.
 */
export function reorderQueueByNeed(input: ReorderQueueInput): ReorderQueueResult {
  const { queue, availableNames, sport } = input
  const needByPosition: Record<string, number> = {}
  const normalizedAvailable = availableNames ?? null
  const queueAvailable = normalizedAvailable
    ? queue.filter((entry) => normalizedAvailable.has((entry.playerName || '').trim().toLowerCase()))
    : queue
  const removedUnavailable = Math.max(0, queue.length - queueAvailable.length)

  const needs = engineNeeds(input, queueAvailable)
  const scored = queueAvailable.map((entry, index) => {
    const pos = normalizeDraftSlot(entry.position ?? '', sport)
    const score = needs[pos] ?? NO_TARGET_NEED
    if (pos) needByPosition[pos] = score
    return { entry, score, position: pos, index }
  })

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.position !== b.position) return (a.position || '').localeCompare(b.position || '')
    return a.index - b.index
  })

  const reordered = scored.map((s) => s.entry)
  // The positions the engine rates most needed among those actually in the queue.
  const topNeeds = Object.entries(needByPosition)
    .filter(([, score]) => score >= 50)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([p]) => p)
    .slice(0, 3)
  let explanation =
    topNeeds.length > 0
      ? `Reordered by roster need: prioritizing ${topNeeds.join(', ')}. Queue order now reflects best fit for your current roster.`
      : 'Reordered by roster balance. Queue order now reflects position need and availability.'
  if (removedUnavailable > 0) {
    explanation += ` Removed ${removedUnavailable} drafted/unavailable player${removedUnavailable === 1 ? '' : 's'} from queue.`
  }

  return { reordered, explanation, needByPosition }
}

/**
 * Same as `reorderQueueByNeed`, but entries with `lockedByUser: true` stay fixed at their index;
 * only unlocked rows are reordered among the unlocked slots (deterministic merge).
 */
export function reorderQueueByNeedRespectingLocks(input: ReorderQueueInput): ReorderQueueResult {
  const { queue, availableNames } = input

  const unlocked = queue.filter((e) => !e.lockedByUser)
  if (unlocked.length === 0) {
    return {
      reordered: queue.map((e) => ({ ...e })),
      explanation: 'All queue slots are locked; order unchanged.',
      needByPosition: {},
    }
  }

  const sub = reorderQueueByNeed({ ...input, queue: unlocked, availableNames })

  let u = 0
  const merged = queue.map((entry) => {
    if (entry.lockedByUser) return { ...entry }
    const next = sub.reordered[u++]
    return next ? { ...next } : { ...entry }
  })

  return {
    reordered: merged,
    explanation: sub.explanation,
    needByPosition: sub.needByPosition,
  }
}
