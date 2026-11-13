/**
 * The tanking monitor's judgement, as rules. Pure — no IO — so every claim it can make is testable.
 *
 * ⚠ THIS REPLACED A MODEL THAT NEVER ANSWERED. The scan asked a model for verdict, severity and
 * confidence, but the model id it named returned 404, so every suspicious lineup was filed as
 * "suspicious · medium · 50%" whatever it held. The collusion monitor had already moved to a
 * code-computed review; this does the same for lineups. A rule can be read, checked and argued with,
 * which is what a commissioner needs before accusing someone of tanking.
 *
 * ⚠ AN UNPLAYABLE STARTER IS ONLY EVIDENCE WHEN THE BENCH HAD SOMEONE WHO COULD LEGALLY TAKE THE
 * SLOT. Starting an OUT running back when the only healthy bench player is a quarterback is not a
 * choice to lose. The bench used to be compared by projection alone, position-blind, so a benched QB
 * "out-projected" a starting WR. Eligibility now goes through `canFillSlotForSport`, the same table
 * the app uses to decide who may fill a slot.
 */

import { canFillSlotForSport } from '@/lib/core-app/sportSlotEligibility'

export type TankingSeverity = 'low' | 'medium' | 'high'

export type CardPlayer = {
  playerId: string
  status?: string
  proj?: number
  byeWeek?: number | null
  position?: string | null
  slot?: string
}

/** Why a player could not score this week, or null when he could. */
export function unplayableReason(p: CardPlayer, week: number): 'BYE' | string | null {
  if (typeof p.byeWeek === 'number' && p.byeWeek === week) return 'BYE'
  const status = (p.status ?? '').trim().toUpperCase()
  if (status.includes('OUT') || status.includes('IR') || status === 'DOUBTFUL' || status === 'D' || status === 'SUSPENDED' || status === 'SUS') {
    return status
  }
  return null
}

/** The slot a starter filled, for eligibility and for the card: his week slot, else his position. */
export function starterSlot(p: CardPlayer): string {
  return (p.slot ?? p.position ?? '').trim().toUpperCase()
}

/**
 * The bench players who could have LEGALLY filled this starter's slot and could actually play,
 * strongest projection first. Unknown positions or slots fit nothing — eligibility is never guessed.
 */
export function eligibleBench(
  starter: CardPlayer,
  bench: readonly CardPlayer[],
  sport: string | null | undefined,
  week: number,
): CardPlayer[] {
  const slot = starterSlot(starter)
  if (!slot) return []
  return bench
    .filter((b) => unplayableReason(b, week) == null && canFillSlotForSport(sport, slot, b.position ?? null))
    .sort((a, b) => (b.proj ?? 0) - (a.proj ?? 0))
}

/**
 * The run of consecutive weeks ending at `week` among the weeks a case has been flagged. A gap breaks
 * the run: weeks 3, 5 and 6 are two in a row, not three.
 */
export function consecutiveRun(weeks: readonly number[], week: number): number {
  const set = new Set(weeks)
  let run = 0
  for (let w = week; set.has(w); w--) run++
  return run
}

/**
 * How serious a case is. Repetition is the strongest signal — one bad week is often a manager who
 * was not paying attention; three in a row is a pattern — and a team already out of contention has
 * a motive the others do not.
 */
export function tankingSeverity(input: { suspiciousStarters: number; consecutiveWeeks: number; eliminated: boolean }): TankingSeverity {
  const { suspiciousStarters: n, consecutiveWeeks: weeks, eliminated } = input
  if (weeks >= 3 || n >= 3 || (eliminated && weeks >= 2)) return 'high'
  if (weeks >= 2 || n >= 2 || eliminated) return 'medium'
  return 'low'
}

const RANK: Record<TankingSeverity, number> = { low: 1, medium: 2, high: 3 }

/** The more serious of two levels — a case extended by a new week never gets milder. */
export function maxSeverity(a: string | null | undefined, b: TankingSeverity): TankingSeverity {
  const prev = a === 'low' || a === 'medium' || a === 'high' ? a : null
  return prev && RANK[prev] > RANK[b] ? prev : b
}

export function severityRank(s: string | null | undefined): number {
  return s === 'low' || s === 'medium' || s === 'high' ? RANK[s] : 0
}

/** The plain-language summary on the flag, built from what the lineup shows. */
export function tankingSummary(input: { idleOnly: boolean; suspiciousStarters: number; consecutiveWeeks: number }): string {
  const n = input.suspiciousStarters
  const players = n === 1 ? 'a player' : `${n} players`
  const base = input.idleOnly
    ? `Started ${players} whose team had no game, while a bench player who could fill the spot did play.`
    : `Started ${players} who could not play, while a healthy bench player could have taken the spot.`
  return input.consecutiveWeeks >= 2 ? `${base} ${input.consecutiveWeeks} weeks in a row.` : base
}
