import type { OptimizerPlayer } from '@/lib/chimmy/lineupOptimizerGrounding'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { lineupCheckHref, type LeagueLineupCheck, type LineupIssue, type ScheduledGame } from './lineupCheck'

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

const BODY_MAX = 280

function shortName(name: string): string {
  const n = name.trim()
  return n.length > 28 ? `${n.slice(0, 27).trimEnd()}…` : n
}

function who(p: OptimizerPlayer): string {
  const bits = [p.position, p.team].filter(Boolean).join(', ')
  return bits ? `${p.name} (${bits})` : p.name
}

function names(ps: readonly OptimizerPlayer[]): string {
  const list = ps.map(who)
  return list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/**
 * One issue, said ONLY as far as it locks in this slate (founder, 2026-10-08).
 *
 * ⚠ THE FIRST VERSION REPEATED THE WEEKLY CHECK'S WHOLE RESHUFFLE. A Thursday message read "Start
 * DeVonta Smith, Tyler Higbee and Jaylen Wright, bench Ryan Flournoy, Dohnte Meyers and Kenneth
 * Gainwell (+18.2)" because one of six players played Thursday — measured on the 19 messages sent
 * before 2026-10-08's TNF, one titled "16 fixes across 4 leagues". Only the moves touching THIS
 * game have to happen before it locks; the rest are Sunday's business, and the weekly lineup check
 * says them then. So a reshuffle names only its players in this slate, and quotes the projected
 * gain only when the whole swap is in this slate — otherwise the number would credit Thursday's
 * move with Sunday's points.
 */
export function slateIssueLine(issue: LineupIssue, inSlate: (p: OptimizerPlayer) => boolean): string | null {
  if (issue.kind === 'empty_slots') {
    return issue.count === 1 ? 'A starting spot is empty.' : `${issue.count} starting spots are empty.`
  }
  if (issue.kind === 'no_projection') {
    return `${who(issue.player)} is starting with no projection for this game — check he is active.`
  }
  if (issue.kind === 'ruled_out') return null
  const start = issue.start.filter(inSlate)
  const bench = issue.bench.filter(inSlate)
  if (start.length === 0 && bench.length === 0) return null
  const rest = issue.start.length + issue.bench.length - start.length - bench.length
  const moves = [start.length ? `start ${names(start)}` : null, bench.length ? `bench ${names(bench)}` : null]
    .filter(Boolean)
    .join(' and ')
  const said = `${moves.charAt(0).toUpperCase()}${moves.slice(1)}`
  if (rest > 0) return `${said} before kickoff; the rest of that swap can wait for later games.`
  return issue.gain != null ? `${said} (+${issue.gain.toFixed(1)} projected pts).` : `${said}.`
}

/** "Lineups lock in 60 min (8:15 PM ET): 2 fixes in League" — with only this slate's moves in the body. */
export function renderSlateLock(
  found: readonly LeagueLineupCheck[],
  slate: Date,
  now: Date,
  inSlate: (p: OptimizerPlayer) => boolean,
): SlateLockMessage | null {
  const lines: Array<{ leagueId: string; leagueName: string; text: string[]; fixes: number }> = []
  for (const l of found) {
    const text = l.issues.map((i) => slateIssueLine(i, inSlate)).filter((t): t is string => Boolean(t))
    if (text.length === 0) continue
    const fixes = l.issues.reduce((n, i) => n + (i.kind === 'empty_slots' ? i.count : i.kind === 'ruled_out' ? 0 : 1), 0)
    lines.push({ leagueId: l.leagueId, leagueName: l.leagueName, text, fixes })
  }
  if (lines.length === 0) return null
  const fixes = lines.reduce((n, l) => n + l.fixes, 0)
  const mins = Math.max(1, Math.round((slate.getTime() - now.getTime()) / 60_000))
  const what = `${fixes} ${fixes === 1 ? 'fix' : 'fixes'}`
  const where = lines.length === 1 ? `in ${shortName(lines[0]!.leagueName)}` : `across ${lines.length} leagues`
  let body = lines.map((l) => `${shortName(l.leagueName)}: ${l.text.join(' ')}`).join('\n')
  if (body.length > BODY_MAX) body = `${body.slice(0, BODY_MAX - 1).trimEnd()}…`
  return {
    title: `Lineups lock in ${mins} min (${slateClock(slate)}): ${what} ${where}`,
    body,
    actionHref: lineupCheckHref(lines[0]!.leagueId),
  }
}
