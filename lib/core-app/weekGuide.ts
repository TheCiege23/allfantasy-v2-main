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

/* ── What to do in each game (2026-11-13, owner: "users know exactly what they need to do") ─── */

/** The lineup facts the week guide needs for one league, from `MyTeamPulse` (myTeamPulse.ts). */
export type LineupFact = {
  leagueId: string
  empty: number
  out: number
  /** Null when byes could not be read for this league. */
  bye: number | null
  questionable: number
  /** When the lineup (or its first starter) locks, ISO; null when unknown. */
  lockAt: string | null
  locked: boolean
  /** Best ball or a lineup the platform sets itself — nothing for the manager to set. */
  automatic: boolean
  /** Where the lineup is changed: the league's My Team screen. */
  href: string
}

type PulseRowLike = {
  leagueId: string
  empty: number
  out: number
  bye: number | null
  questionable: number
  lockAt: string | null
  locked: boolean
  bestBall?: boolean
  automatic?: boolean
  archived?: boolean
  href: string
}

/**
 * One fact per league from the pulse's rows. `inventory` is every league in view, uncapped; `needs`
 * and `set` are capped lists, used only when inventory is absent. Archived rows are not this week.
 */
export function lineupFacts(pulse: { inventory?: PulseRowLike[]; needs: PulseRowLike[]; set: PulseRowLike[] } | null | undefined): Map<string, LineupFact> {
  const out = new Map<string, LineupFact>()
  if (!pulse) return out
  const rows = pulse.inventory && pulse.inventory.length > 0 ? pulse.inventory : [...pulse.needs, ...pulse.set]
  for (const r of rows) {
    if (r.archived || out.has(r.leagueId)) continue
    out.set(r.leagueId, {
      leagueId: r.leagueId,
      empty: Math.max(0, r.empty || 0),
      out: Math.max(0, r.out || 0),
      bye: r.bye == null ? null : Math.max(0, r.bye),
      questionable: Math.max(0, r.questionable || 0),
      lockAt: r.lockAt,
      locked: Boolean(r.locked),
      automatic: Boolean(r.bestBall || r.automatic),
      href: r.href,
    })
  }
  return out
}

/**
 * The single most useful thing to do in one game, worst problem first:
 *   fill     an empty starting slot (scores zero)
 *   swap     starters ruled out or on bye
 *   check    questionable starters — a decision, not a certain hole
 *   set      nothing wrong we can see; the edge left is the free-agent pool
 *   auto     best ball / platform-set lineup — nothing to set
 *   locked   the lineup has locked
 *   unknown  no lineup read for this league
 */
export type GameAction =
  | { kind: 'fill'; count: number; lockAt: string | null; href: string }
  | { kind: 'swap'; count: number; lockAt: string | null; href: string }
  | { kind: 'check'; count: number; lockAt: string | null; href: string }
  | { kind: 'set'; href: string }
  | { kind: 'auto'; href: string }
  | { kind: 'locked'; href: string }
  | { kind: 'unknown'; href: string }

export function gameAction(fact: LineupFact | undefined, gameHref: string): GameAction {
  if (!fact) return { kind: 'unknown', href: gameHref }
  if (fact.automatic) return { kind: 'auto', href: fact.href }
  if (fact.locked) return { kind: 'locked', href: gameHref }
  if (fact.empty > 0) return { kind: 'fill', count: fact.empty, lockAt: fact.lockAt, href: fact.href }
  const holes = fact.out + (fact.bye ?? 0)
  if (holes > 0) return { kind: 'swap', count: holes, lockAt: fact.lockAt, href: fact.href }
  if (fact.questionable > 0) return { kind: 'check', count: fact.questionable, lockAt: fact.lockAt, href: fact.href }
  return { kind: 'set', href: `/core/waivers?league=${encodeURIComponent(fact.leagueId)}` }
}

/** Lineups with a certain hole (empty slot, starter out or on bye) that can still be changed. */
export function lineupsToFix(facts: ReadonlyMap<string, LineupFact>): { count: number; firstHref: string | null } {
  let count = 0
  let firstHref: string | null = null
  for (const f of facts.values()) {
    if (f.automatic || f.locked) continue
    if (f.empty + f.out + (f.bye ?? 0) > 0) {
      count += 1
      firstHref ??= f.href
    }
  }
  return { count, firstHref }
}

/**
 * "Ahead so far, projected to lose" — a scored game whose live lead points the other way from its
 * pre-game projection. The board listed such a game under LEADING with nothing to say it was expected
 * to turn; null when the two agree, or when there is no live score or no projection to compare.
 */
export function projectionDisagrees(m: Pick<WeekMatchup, 'live' | 'projection'>): 'ahead-projected-lose' | 'behind-projected-win' | null {
  if (!m.live || m.live.final || !m.projection) return null
  if (m.live.margin > 0 && m.projection.margin < 0) return 'ahead-projected-lose'
  if (m.live.margin < 0 && m.projection.margin > 0) return 'behind-projected-win'
  return null
}
