/**
 * Player draft outlook + "you're up" suggestion — pure helpers.
 *
 * Pure logic only — no Prisma, no fetch, no React.
 *
 * `buildPlayerDraftOutlook` answers, for one player, the questions the player
 * card's "draft outlook" section shows: how likely he is to last to the
 * viewer's next pick, whether he is falling past his ADP, which managers
 * picking before then still need his position, and whether the Intel
 * lookahead projects someone to take him. Market ADP only, as everywhere in
 * draftPulse.
 *
 * `pickYoureUpSuggestion` chooses the player the "you're up" alert offers:
 * the first still-available queued player, else the best available by market
 * ADP.
 */

import type { LookaheadResult } from './draftIntelLookahead'
import { survivalProbability, type PulsePoolPlayer } from './draftPulse'

export type PlayerDraftOutlook = {
  /** Estimated chance he is available at `leftAtLabel`; null without ADP or next pick. */
  survival: number | null
  leftAtLabel: string | null
  /** currentOverall − ADP: > 0 means he is already past his ADP (falling). Null without ADP. */
  pastAdpBy: number | null
  /** Managers picking before the viewer's next turn (deduplicated, in pick order). */
  managersBefore: number
  /** Of those, the ones who have not filled his position. */
  needers: string[]
  /** The lookahead row projected to take him, if any. */
  projectedBy: { displayName: string; pickLabel: string } | null
}

function normName(name: string | null | undefined): string {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function normPos(pos: string | null | undefined): string {
  return String(pos ?? '').trim().toUpperCase()
}

export function buildPlayerDraftOutlook(input: {
  player: { name: string; position: string; adp?: number | null }
  lookahead: LookaheadResult | null
  currentOverall: number | null
  leftAtPick: { overall: number; label: string } | null
}): PlayerDraftOutlook {
  const { player, lookahead, currentOverall, leftAtPick } = input
  const adp = typeof player.adp === 'number' && Number.isFinite(player.adp) && player.adp > 0 ? player.adp : null
  const pos = normPos(player.position)
  const name = normName(player.name)

  const seen = new Set<string>()
  const needers: string[] = []
  let projectedBy: PlayerDraftOutlook['projectedBy'] = null
  for (const row of lookahead?.rows ?? []) {
    if (!projectedBy && row.projected && normName(row.projected.name) === name && normPos(row.projected.position) === pos) {
      projectedBy = { displayName: row.displayName, pickLabel: row.pickLabel }
    }
    if (seen.has(row.rosterId)) continue
    seen.add(row.rosterId)
    if (row.needs.includes(pos)) needers.push(row.displayName)
  }

  return {
    survival: leftAtPick ? survivalProbability(adp, leftAtPick.overall) : null,
    leftAtLabel: leftAtPick?.label ?? null,
    pastAdpBy: adp != null && currentOverall != null ? currentOverall - adp : null,
    managersBefore: seen.size,
    needers,
    projectedBy,
  }
}

export type YoureUpSuggestion<P> = { player: P; source: 'queue' | 'best_available' }

/**
 * The player the "you're up" alert offers. `queue` is in queue order and
 * `isAvailable` filters out anyone already drafted; `available` is the
 * undrafted pool. Players without market ADP are never the best-available
 * pick (there is no ranking to stand on).
 */
export function pickYoureUpSuggestion<P extends PulsePoolPlayer>(input: {
  queue: readonly P[]
  available: readonly P[]
  isAvailable: (p: P) => boolean
}): YoureUpSuggestion<P> | null {
  const queued = input.queue.find((p) => input.isAvailable(p))
  if (queued) return { player: queued, source: 'queue' }
  let best: P | null = null
  for (const p of input.available) {
    if (typeof p.adp !== 'number' || !Number.isFinite(p.adp) || p.adp <= 0) continue
    if (!best || p.adp < (best.adp as number)) best = p
  }
  return best ? { player: best, source: 'best_available' } : null
}
