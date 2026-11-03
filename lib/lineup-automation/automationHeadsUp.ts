/**
 * HEADS-UP BEFORE ALLFANTASY ACTS (phase 13, 2026-10-29).
 *
 * "Fill an empty starting spot" is on by default, so a manager may never have chosen it. Before it
 * changes their lineup, the first run that finds an empty spot TELLS the owner what it plans to do and
 * waits `HEADS_UP_MS`; a later run fills it only if the lineup is still left that way. Setting the
 * lineup in between — even leaving the spot empty on purpose — restarts the usual three-hour idle wait.
 *
 * ⚠ NEVER WAIT ONCE GAMES ARE UNDER WAY. When any player on the team is already locked this week, the
 * next game could start before a second run, and an empty spot scores nothing. Then it acts at once,
 * and the "filled" notice still says what changed. One heads-up per team per week.
 *
 * Pure.
 */
export const HEADS_UP_MS = 3 * 60 * 60 * 1000
export const HEADS_UP_CACHE_PREFIX = 'af-heads-up:'

export type HeadsUpDecision = 'warn' | 'wait' | 'act'

export function headsUpDecision(args: { warnedAt: Date | null; now: Date; gamesUnderway: boolean }): HeadsUpDecision {
  if (args.gamesUnderway) return 'act'
  if (!args.warnedAt) return 'warn'
  return args.now.getTime() - args.warnedAt.getTime() >= HEADS_UP_MS ? 'act' : 'wait'
}

export function headsUpKey(kind: 'fill_empty_starters', rosterId: string, season: number, week: number): string {
  return `${HEADS_UP_CACHE_PREFIX}${kind}:${rosterId}:${season}:${week}`
}
