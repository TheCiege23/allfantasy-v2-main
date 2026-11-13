/**
 * The headline of a league's My team page in plain words (2026-11-13). The owner's ask: users should
 * know what the page is for and exactly what to do. The answer people open it for is "is my lineup
 * OK, and what should I change?" — already computed by the lineup check (lib/core-app/lineupCheck.ts)
 * and the lineup optimizer; this only reads them into one sentence and a few numbers.
 *
 * Pure, so the rule is testable and the screen stays a renderer.
 */
import type { LineupCheck } from '@/lib/core-app/lineupCheck'

export type MyTeamHeadline =
  /** Best Ball: the platform picks the scoring lineup, there is nothing to set. */
  | { kind: 'auto' }
  /** A starter who will certainly score zero or can be beaten: out, on bye, an empty slot. */
  | { kind: 'fix'; count: number }
  /** Nothing certain, but starters listed questionable — have a backup ready. */
  | { kind: 'questionable'; count: number }
  /** Nothing to fix, but the best lineup projects clearly more (outside the projection's margin). */
  | { kind: 'better'; gain: number }
  /** Nothing found among the players we could read. */
  | { kind: 'set' }
  /** No starters could be read at all. */
  | { kind: 'unknown' }

/** The kinds that mean a starter will score zero (or a slot is empty) unless you act. */
const CERTAIN = new Set(['out', 'bye', 'empty'])

export function myTeamHeadline(input: {
  bestBall: boolean
  check: Pick<LineupCheck, 'items'> | null
  /** The optimizer's verdict: only a CLEAR gain changes the headline — "close" is inside the margin. */
  optimizer?: { state: string; gain?: number; verdict?: string } | null
}): MyTeamHeadline {
  if (input.bestBall) return { kind: 'auto' }
  if (!input.check) return { kind: 'unknown' }
  const fix = input.check.items.filter((i) => CERTAIN.has(i.kind)).length
  if (fix > 0) return { kind: 'fix', count: fix }
  const q = input.check.items.filter((i) => i.kind === 'questionable').length
  if (q > 0) return { kind: 'questionable', count: q }
  const o = input.optimizer
  if (o && o.state === 'improve' && o.verdict !== 'close' && o.gain != null && o.gain > 0) return { kind: 'better', gain: o.gain }
  return { kind: 'set' }
}

/** Starters the page asks you to look at: the certain problems plus the questionable ones. */
export function startersToCheck(check: Pick<LineupCheck, 'items'> | null): number {
  if (!check) return 0
  return check.items.filter((i) => CERTAIN.has(i.kind) || i.kind === 'questionable').length
}
