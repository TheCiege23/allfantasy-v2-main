/**
 * The inactive-manager ladder (2026-11-12, owner: commissioners should see league health and
 * inactive users, and know what to do about them).
 *
 * The hub already said HOW MANY managers were quiet. It did not say what to do about each one, and
 * the right move depends on how long they have been gone: a week is a nudge, two is a warning, three
 * is time to line up a replacement. This turns each manager's activity row into one rung, with a
 * message the commissioner can copy and send themselves.
 *
 * WHAT "QUIET" IS MEASURED FROM. The same activity rows the hub's "Active managers" tile and the
 * abandoned-teams flag read (`resolveMemberActivity`, ./activity.ts): on an imported league, the
 * last trade, waiver claim or roster move; on an AllFantasy league, the roster's own timestamp. It is
 * NOT a count of missed lineups — no per-week lineup history is stored, and the card says "quiet",
 * never "missed N lineups", for that reason.
 *
 * ⚠ A MANAGER WITH NO MOVE ON FILE. On an imported league, `readManagerActivity` lists only
 * managers with a move in the current or prior window; everyone else is added with no
 * `lastActionAt` and judged `inactive`. That is "no move in at least two windows", the longest quiet
 * this data can show, so it lands on the top rung — but with `daysQuiet: null`, so the copy says
 * "no move on file" rather than inventing a number.
 *
 * ⚠ NEVER SENT FOR THE COMMISSIONER. The ladder drafts text and links; sending stays a person's
 * action. A league that has stopped syncing is not laddered at all — the caller skips it, exactly as
 * the hub already declines to judge activity on stale data.
 *
 * PURE and client-safe.
 */

import type { MemberActivityRow } from './activity'

export type LadderStep = 'nudge' | 'warn' | 'replace'

/** Days without a move at which each rung starts. */
export const LADDER_DAYS: Readonly<Record<LadderStep, number>> = { nudge: 7, warn: 14, replace: 21 }

const RUNG: Record<LadderStep, number> = { replace: 0, warn: 1, nudge: 2 }

/**
 * League states where a quiet manager is normal and laddering them would be noise: before the draft,
 * after the season, or a league that is finished with. Anything else is treated as a live season.
 */
const OFF_SEASON = new Set(['setup', 'pre_draft', 'completed', 'complete', 'archived', 'dismissed'])

export function ladderApplies(league: { status?: string | null; lifecycleState?: string | null }): boolean {
  const states = [league.status, league.lifecycleState].map((s) => (s ?? '').trim().toLowerCase())
  return !states.some((s) => OFF_SEASON.has(s))
}

const DAY_MS = 86_400_000

/** Whole days since a move, or null when none is on file (or the stamp is unreadable). */
export function daysQuiet(lastActionAt: string | null, now: Date): number | null {
  if (!lastActionAt) return null
  const at = Date.parse(lastActionAt)
  if (!Number.isFinite(at)) return null
  return Math.max(0, Math.floor((now.getTime() - at) / DAY_MS))
}

/**
 * The rung for one manager, or null when they need nothing. An `unknown` status is never laddered:
 * the activity read could not judge them, and a warning sent on a guess is worse than none.
 */
export function ladderStep(row: Pick<MemberActivityRow, 'status' | 'lastActionAt'>, now: Date): LadderStep | null {
  if (row.status === 'unknown') return null
  const days = daysQuiet(row.lastActionAt, now)
  if (days == null) return row.status === 'inactive' ? 'replace' : null
  if (days >= LADDER_DAYS.replace) return 'replace'
  if (days >= LADDER_DAYS.warn) return 'warn'
  if (days >= LADDER_DAYS.nudge) return 'nudge'
  return null
}

export type LadderEntry = {
  id: string
  leagueId: string
  leagueName: string
  manager: string
  step: LadderStep
  /** Null when no move is on file at all — see the header. */
  daysQuiet: number | null
  /** Where the commissioner acts: the league's hub page, or the replace-a-manager workflow. */
  href: string
}

export type LadderLeague = {
  leagueId: string
  leagueName: string
  managers: Array<Pick<MemberActivityRow, 'name' | 'status' | 'lastActionAt'>>
  /** The league hub page — where a nudge or warning is followed up. */
  hubHref: string
  /** Where a replacement is arranged (orphan teams on an AllFantasy league, the hub workflow otherwise). */
  replaceHref: string
}

/**
 * Every rung across the leagues given, worst first: replace, then warn, then nudge; inside a rung the
 * longest quiet first, with "no move on file" counted as longest of all.
 */
export function buildInactiveLadder(leagues: readonly LadderLeague[], now: Date): LadderEntry[] {
  const out: LadderEntry[] = []
  for (const league of leagues) {
    for (const m of league.managers) {
      const step = ladderStep(m, now)
      if (!step) continue
      out.push({
        id: `${league.leagueId}:ladder:${m.name}`,
        leagueId: league.leagueId,
        leagueName: league.leagueName,
        manager: m.name,
        step,
        daysQuiet: daysQuiet(m.lastActionAt, now),
        href: step === 'replace' ? league.replaceHref : league.hubHref,
      })
    }
  }
  return out.sort(
    (a, b) =>
      RUNG[a.step] - RUNG[b.step] ||
      (b.daysQuiet ?? Infinity) - (a.daysQuiet ?? Infinity) ||
      a.leagueName.localeCompare(b.leagueName) ||
      a.manager.localeCompare(b.manager),
  )
}

/** Counts per rung, for a one-line summary. */
export function ladderCounts(entries: readonly LadderEntry[]): Record<LadderStep, number> {
  const counts: Record<LadderStep, number> = { nudge: 0, warn: 0, replace: 0 }
  for (const e of entries) counts[e.step] += 1
  return counts
}
