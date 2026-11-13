/**
 * BEST BALL value helpers (pure, deterministic).
 *
 * Best ball cares about CEILING/spike-weeks and draft value, not weekly start/sit.
 * - `ceilingValue` uses the player's REAL max weekly score when scores exist; otherwise
 *   an ADP-derived proxy (clearly a proxy, flagged by source) — never fabricated.
 * - `draftValue` is the ADP-derived value (lower ADP = higher value).
 */

import type { BestBallPlayerFact } from './types'

export type ValueSource = 'weekly_max' | 'weekly_avg' | 'projection' | 'adp' | 'none'

/** Map an average overall ADP (lower = better) onto a positive value scale. */
export function adpToValue(adp: number): number {
  return Math.round((Math.max(0, 260 - adp) / 10) * 100) / 100
}

/** Draft/asset value (ADP-derived). */
export function draftValue(p: BestBallPlayerFact): { value: number; source: ValueSource } {
  if (p.adp != null) return { value: adpToValue(p.adp), source: 'adp' }
  return { value: 0, source: 'none' }
}

/**
 * Spike-week CEILING signal. Prefers real max weekly score → avg → projection → ADP proxy.
 * Source is reported so the UI/prompt can flag ADP-proxy ceilings honestly.
 */
export function ceilingValue(p: BestBallPlayerFact): { value: number; source: ValueSource } {
  if (p.maxPoints != null) return { value: p.maxPoints, source: 'weekly_max' }
  if (p.avgPoints != null) return { value: p.avgPoints, source: 'weekly_avg' }
  if (p.weekProjection != null) return { value: p.weekProjection, source: 'projection' }
  if (p.adp != null) return { value: adpToValue(p.adp), source: 'adp' }
  return { value: 0, source: 'none' }
}

