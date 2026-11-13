import type { EliminationWeek, WeekBoard, WeekMatchup } from './weekBoard'
import type { WeeklyCalendar, WeeklyCalendarEvent } from './weeklyCalendar'

/**
 * The /core/week tab as a guide (2026-11-13, owner: "do the same as you did for core").
 *
 * The week board already knew which games were coin flips, which were leaning, which survival leagues
 * had you on the block and when every starter kicked off. The page said all of that twice — a
 * "Blueprint" paragraph and a second "Your week" page stacked under it — in data-pipeline language. This
 * module is the pure half of the simpler page: one set of counts for the headline, the close games
 * worth acting on, the survival leagues in plain words, and kickoffs grouped by time.
 *
 * PURE and client-safe: it reads the WeekBoard and WeeklyCalendar the page already loads.
 */

/* ── Headline counts ─────────────────────────────────────────────────────────────────────────── */

export type WeekSummary = {
  /** Head-to-head games you lead, on the scoreboard once points are in, else on projection. */
  winning: number
  losing: number
  /** Projected inside 40–60% to win (`WeekBoard.coinFlips`) and not yet final. */
  close: number
  /** Head-to-head games with neither a score nor a projection yet. */
  unknown: number
  /** Survival (guillotine-style) leagues where you hold the lowest score right now. */
  survivalAtRisk: number
  survival: number
  /** Leagues with no game scheduled this week. */
  noGame: number
  firstKickoffAt: string | null
}

/** The margin a game is ranked on: the scoreboard once points are in, the projection before. */
export function gameMargin(m: WeekMatchup): number | null {
  if (m.live) return m.live.margin
  if (m.projection) return m.projection.margin
  return null
}

/** Coin flips still in play — a final game is decided, however close the projection was. */
export function closeGames(board: Pick<WeekBoard, 'coinFlips'>): WeekMatchup[] {
  return board.coinFlips.filter((m) => !m.live?.final)
}

export function summarizeWeek(board: WeekBoard): WeekSummary {
  let winning = 0
  let losing = 0
  let unknown = 0
  for (const m of [...board.coinFlips, ...board.leaning, ...board.unprojected]) {
    const margin = gameMargin(m)
    if (margin == null) unknown += 1
    else if (margin > 0) winning += 1
    else if (margin < 0) losing += 1
  }
  return {
    winning,
    losing,
    close: closeGames(board).length,
    unknown,
    survivalAtRisk: board.eliminationWeeks.filter((e) => e.onTheBlock).length,
    survival: board.eliminationWeeks.length,
    noGame: board.withoutSchedule,
    firstKickoffAt: board.firstKickoffAt,
  }
}

/* ── Survival leagues in plain words ─────────────────────────────────────────────────────────── */

/**
 * Where you stand in a league with no opponent, where the lowest score each week is eliminated.
 *   lowest       you hold the lowest score right now — the board printed this as "OUT", which read
 *                as already eliminated; it is not, the week is still being played
 *   above        points above the current lowest score
 *   not-started  nobody has scored yet, so there is no lowest score to compare with
 *
 * `EliminationWeek.margin` is your score minus the current lowest score, so it is never negative.
 */
export type SurvivalStatus =
  | { kind: 'lowest' }
  | { kind: 'above'; points: number }
  | { kind: 'not-started' }

export function survivalStatus(e: Pick<EliminationWeek, 'onTheBlock' | 'margin' | 'fieldSize'>): SurvivalStatus {
  if (e.fieldSize === 0 || e.margin == null) return { kind: 'not-started' }
  if (e.onTheBlock) return { kind: 'lowest' }
  return { kind: 'above', points: Math.round(e.margin * 10) / 10 }
}

/** Survival leagues in the order that matters: lowest score first, then closest to it, then not started. */
export function rankSurvival(weeks: readonly EliminationWeek[]): EliminationWeek[] {
  const rank = (e: EliminationWeek) => {
    const s = survivalStatus(e)
    return s.kind === 'lowest' ? 0 : s.kind === 'above' ? 1 : 2
  }
  return [...weeks].sort(
    (a, b) => rank(a) - rank(b) || (a.margin ?? Infinity) - (b.margin ?? Infinity) || a.leagueName.localeCompare(b.leagueName),
  )
}

/* ── Kickoffs grouped by time ────────────────────────────────────────────────────────────────── */

export type KickoffGroup = {
  /** ISO instant — formatted in the reader's own time zone by the client. */
  at: string
  leagues: Array<{ leagueId: string; leagueName: string; href: string }>
}

/**
 * The calendar's "next game" events, one row per kickoff time instead of one per league. On a
 * Sunday with a London game the old list printed the same 9:30 AM seven times in a row.
 *
 * ⚠ A KICKOFF IS NOT A LINEUP LOCK. These are when your stored starters next play; whether the whole
 * lineup locks then is a league setting the calendar cannot read — the card says so.
 */
export function groupKickoffs(calendar: Pick<WeeklyCalendar, 'events'> | null | undefined, limit = 5): {
  groups: KickoffGroup[]
  more: number
} {
  if (!calendar) return { groups: [], more: 0 }
  const byTime = new Map<string, KickoffGroup>()
  for (const e of calendar.events) {
    if (e.kind !== 'game') continue
    const group = byTime.get(e.at) ?? { at: e.at, leagues: [] }
    if (!group.leagues.some((l) => l.leagueId === e.leagueId)) {
      group.leagues.push({ leagueId: e.leagueId, leagueName: e.leagueName, href: e.href })
    }
    byTime.set(e.at, group)
  }
  const sorted = [...byTime.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  return { groups: sorted.slice(0, limit), more: Math.max(0, sorted.length - limit) }
}

/** The calendar's other deadlines this week (waivers, trades, drafts, polls…), soonest first. */
export function otherDeadlines(calendar: Pick<WeeklyCalendar, 'events'> | null | undefined, limit = 4): WeeklyCalendarEvent[] {
  if (!calendar) return []
  return calendar.events
    .filter((e) => e.kind !== 'game')
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(0, limit)
}
