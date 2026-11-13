/**
 * Guillotine player value helpers (pure, deterministic).
 *
 * Survival-first: FLOOR matters more than ceiling. The best available signal is the weekly
 * projection (a points estimate), else an ADP-derived proxy (lower ADP → safer floor). No
 * fabrication: missing inputs → source 'none'.
 */

import type { GuillotinePlayerFact } from './types'

export type ValueSource = 'projection' | 'adp' | 'none'

function adpToValue(adp: number): number {
  return Math.round((Math.max(0, 260 - adp) / 10) * 100) / 100
}

/** Best-available value signal for a player (projection → ADP proxy → none). */
export function playerValue(p: GuillotinePlayerFact): { value: number; source: ValueSource } {
  if (p.weekProjection != null) return { value: p.weekProjection, source: 'projection' }
  if (p.adp != null) return { value: adpToValue(p.adp), source: 'adp' }
  return { value: 0, source: 'none' }
}

export function isInjured(status: string | null): boolean {
  return Boolean(status) && !/^(healthy|active|ok)$/i.test(String(status))
}
