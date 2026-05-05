/**
 * Reorder draft queue by roster need and availability.
 * Sport-agnostic position targets; supports NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */

import type { QueueEntry } from '@/lib/live-draft-engine/types'

/** Position need weight (higher = more need). Shared across sports. */
const DEFAULT_POSITION_WEIGHTS: Record<string, number> = {
  QB: 90, RB: 85, WR: 85, TE: 75, K: 30, DEF: 40,
  C: 80, LW: 80, RW: 80, D: 75, G: 70,
  PG: 85, SG: 85, SF: 85, PF: 85,
  SP: 85, RP: 75, '1B': 75, '2B': 75, '3B': 75, SS: 75, OF: 80,
  F: 80, M: 80, GK: 70,
}

export interface ReorderQueueInput {
  queue: QueueEntry[]
  /** Current user's roster (positions already drafted) */
  rosterPositions: string[]
  sport: string
  /** Optional set of available names (trimmed lowercase). Unavailable entries are dropped before reorder. */
  availableNames?: Set<string>
  /** Optional: generate short explanation via AI */
  generateExplanation?: boolean
}

export interface ReorderQueueResult {
  reordered: QueueEntry[]
  explanation: string
  /** Position need scores used for ordering */
  needByPosition?: Record<string, number>
}

function getNeedCounts(rosterPositions: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const p of rosterPositions) {
    const pos = (p || '').trim().toUpperCase()
    if (pos) counts[pos] = (counts[pos] ?? 0) + 1
  }
  return counts
}

function needScore(position: string, counts: Record<string, number>): number {
  const pos = (position || '').trim().toUpperCase()
  const weight = DEFAULT_POSITION_WEIGHTS[pos] ?? 50
  const count = counts[pos] ?? 0
  if (count === 0) return weight
  if (count === 1) return Math.max(5, weight - 35)
  if (count === 2) return Math.max(5, weight - 55)
  return Math.max(0, weight - 70)
}

/**
 * Reorder queue: higher need positions first, then by position weight.
 * Preserves all entries; only order changes.
 */
export function reorderQueueByNeed(input: ReorderQueueInput): ReorderQueueResult {
  const { queue, rosterPositions, sport, availableNames } = input
  const counts = getNeedCounts(rosterPositions)
  const needByPosition: Record<string, number> = {}
  const normalizedAvailable = availableNames ?? null
  const queueAvailable = normalizedAvailable
    ? queue.filter((entry) => normalizedAvailable.has((entry.playerName || '').trim().toLowerCase()))
    : queue
  const removedUnavailable = Math.max(0, queue.length - queueAvailable.length)

  const scored = queueAvailable.map((entry, index) => {
    const pos = (entry.position || '').trim().toUpperCase()
    const score = needScore(entry.position ?? '', counts)
    if (pos) needByPosition[pos] = score
    return { entry, score, position: pos, index }
  })

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.position !== b.position) return (a.position || '').localeCompare(b.position || '')
    return a.index - b.index
  })

  const reordered = scored.map((s) => s.entry)
  const topNeeds = Object.entries(counts)
    .filter(([, c]) => c < 2)
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
  const { queue, rosterPositions, sport, availableNames } = input

  const unlocked = queue.filter((e) => !e.lockedByUser)
  if (unlocked.length === 0) {
    return {
      reordered: queue.map((e) => ({ ...e })),
      explanation: 'All queue slots are locked; order unchanged.',
      needByPosition: {},
    }
  }

  const sub = reorderQueueByNeed({
    queue: unlocked,
    rosterPositions,
    sport,
    availableNames,
  })

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
