import type { OptimizerPlayer } from '@/lib/chimmy/lineupOptimizerGrounding'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import {
  countFixes,
  renderLineupCheck,
  type LeagueLineupCheck,
  type LineupIssue,
  type ScheduledGame,
} from './lineupCheck'

/**
 * CHIMMY'S SLATE LOCK CHECK — a lineup check before EVERY slate locks, not just Sunday's (2026-10-08).
 *
 * The weekly lineup check (lineupCheck.ts) runs once, in the window before the week's MAIN slate.
 * Everything that locks earlier or later — Thursday night, the early Sunday window abroad, Sunday
 * night, Monday — had no check at all: a better start sitting on the bench for a Thursday game was
 * never mentioned before that game locked, and after it there is nothing to say.
 *
 * So before each OTHER slate, inside SLATE_LOCK_OPENS_BEFORE_MS..CLOSES_BEFORE_MS, the same optimizer
 * runs and only what LOCKS IN THAT SLATE is said:
 *
 *   - a reshuffle worth PROACTIVE_MIN_GAIN or more that moves a player whose game is this slate;
 *   - a starter in this slate's game with no projection (released, inactive, no game data);
 *   - an empty starting slot — a guaranteed zero — at most once per league per week.
 *
 * ⚠ RULED-OUT STARTERS ARE LEFT TO THE INJURED-STARTER SWEEP, which already pushes "X is listed Out
 * with N minutes to lock", per player, per designation, per day. Saying it twice is how a
 * notification channel gets switched off.
 *
 * ⚠ THE MAIN SLATE IS SKIPPED — the weekly check owns it, with its own window and claim. One fact,
 * one message.
 *
 * Pure: no prisma, no clock. `runSlateLockCheck.ts` reads and sends.
 */

export const SLATE_LOCK_OPENS_BEFORE_MS = 90 * 60 * 1000
export const SLATE_LOCK_CLOSES_BEFORE_MS = 20 * 60 * 1000

/** Every distinct kickoff time in the week, ascending. */
export function slateKickoffs(games: readonly ScheduledGame[]): Date[] {
  const times = new Set<number>()
  for (const g of games) {
    const t = g.startTime?.getTime()
    if (t != null && Number.isFinite(t)) times.add(t)
  }
  return [...times].sort((a, b) => a - b).map((t) => new Date(t))
}

/**
 * The slate whose lock window is open right now, or null. Never the main slate (see the header).
 * The sweep runs every few minutes, so a 70-minute window is reached by several runs; the per-slate
 * claim makes only the first one send.
 */
export function openSlate(games: readonly ScheduledGame[], now: Date, mainSlate: Date | null): Date | null {
  for (const slate of slateKickoffs(games)) {
    if (mainSlate && slate.getTime() === mainSlate.getTime()) continue
    const until = slate.getTime() - now.getTime()
    if (until <= SLATE_LOCK_OPENS_BEFORE_MS && until >= SLATE_LOCK_CLOSES_BEFORE_MS) return slate
  }
  return null
}

/** Does this player's game kick off in `slate`? Teams are matched on the canonical abbreviation. */
export function playsInSlate(kickoffs: ReadonlyMap<string, Date>, slate: Date) {
  return (p: Pick<OptimizerPlayer, 'team'>): boolean => {
    const team = normalizeTeamAbbrev(p.team)
    const kickoff = team ? kickoffs.get(team) : undefined
    return kickoff != null && kickoff.getTime() === slate.getTime()
  }
}

/** The part of a league's issues that locks in this slate. */
export function slateIssues(
  issues: readonly LineupIssue[],
  inSlate: (p: OptimizerPlayer) => boolean,
  opts: { includeEmptySlots: boolean },
): LineupIssue[] {
  return issues.filter((i) => {
    if (i.kind === 'empty_slots') return opts.includeEmptySlots
    if (i.kind === 'no_projection') return inSlate(i.player)
    if (i.kind === 'ruled_out') return false
    return [...i.start, ...i.bench].some(inSlate)
  })
}

/** "7:15 PM ET" — the slate as a manager names it. */
export function slateClock(slate: Date): string {
  return `${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(slate)} ET`
}

export type SlateLockMessage = { title: string; body: string; actionHref: string }

/**
 * The weekly check's own body and link — the same sentences for the same issues — under a title
 * that says what makes this one urgent: when it locks.
 */
export function renderSlateLock(
  found: readonly LeagueLineupCheck[],
  slate: Date,
  now: Date,
  opts: { baseUrl?: string | null } = {},
): SlateLockMessage | null {
  const base = renderLineupCheck(found, opts)
  if (!base) return null
  const withIssues = found.filter((l) => l.issues.length > 0)
  const fixes = countFixes(withIssues)
  const mins = Math.max(1, Math.round((slate.getTime() - now.getTime()) / 60_000))
  const what = `${fixes} ${fixes === 1 ? 'fix' : 'fixes'}`
  const where = withIssues.length === 1 ? `in ${withIssues[0]!.leagueName}` : `across ${withIssues.length} leagues`
  return {
    title: `Lineups lock in ${mins} min (${slateClock(slate)}): ${what} ${where}`,
    body: base.body,
    actionHref: base.actionHref,
  }
}
