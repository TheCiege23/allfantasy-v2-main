/**
 * The top of a league's Schedule tab (/core/schedule?league=…) in plain words (2026-11-13).
 *
 * The owner's ask, for every /core page: users should know what the page is for and what to do. The
 * tab used to open on "Schedule and deadlines" and two panels — a "League calendar" that for most
 * leagues said only "No dated deadlines have been supplied by this league", and "Season phases" printed
 * as raw data ("Trade deadline · WK 11 · future", "Offseason · Date not supplied · future", "Read from
 * this league", a lone "6 teams"). Everything a person wants is already loaded: this week's game
 * (LeagueHomeData.matchup), the season phases (seasonTimeline.ts) and any dated deadline the provider
 * published (leagueCalendar.ts). This reads them into one headline and one "What's next" list.
 *
 * Pure, so the rules are testable and the screen stays a renderer.
 */
import type { TimelinePhase } from '@/lib/core-app/seasonTimeline'
import type { LeagueCalendarEvent } from '@/lib/core-app/leagueCalendar'

/** "WK 11" → 11–11, "WK 15-17" → 15–17, "week 1 onward" → 1–open. Months ("Aug") and null are not weeks. */
export function weekSpan(when: string | null | undefined): { start: number; end: number | null } | null {
  const s = String(when ?? '').trim()
  const range = s.match(/^WK\s*(\d+)\s*[-–]\s*(\d+)$/i)
  if (range) return { start: Number(range[1]), end: Number(range[2]) }
  const one = s.match(/^WK\s*(\d+)$/i)
  if (one) return { start: Number(one[1]), end: Number(one[1]) }
  const onward = s.match(/^week\s*(\d+)\s*onward$/i)
  if (onward) return { start: Number(onward[1]), end: null }
  return null
}

export type NextItem = {
  key: string
  label: string
  state: 'now' | 'future'
  /** The phase's weeks, when it has any. */
  span: { start: number; end: number | null } | null
  /** Weeks until it starts, from the current week: 0 this week, 1 next week; null when unknown or already running. */
  away: number | null
  /** A provider date (ISO) for a dated deadline; null for a week-based phase. */
  at: string | null
  /** A phase's month or other non-week "when" ("Aug"), shown as it is. */
  whenText: string | null
  /** What it means, cleaned of provenance; null when nothing worth saying. */
  detail: string | null
  /** "6 teams" on the playoffs, as a number the copy can say properly. */
  teams: number | null
}

/**
 * ⚠ PROVENANCE IS NOT CONTENT. "Read from this league" says where a week came from — true, and the
 * reason a reader can trust it, but not something they act on. It is stripped; what follows the dash
 * ("no trades accepted after it") is the part that tells them something.
 */
function cleanDetail(detail: string | undefined): { detail: string | null; teams: number | null } {
  const raw = String(detail ?? '').trim()
  if (!raw) return { detail: null, teams: null }
  const teams = raw.match(/^(\d+)\s+teams$/i)
  if (teams) return { detail: null, teams: Number(teams[1]) }
  const stripped = raw.replace(/^Read from this league\s*(?:[—–-]\s*)?/i, '').trim()
  if (!stripped) return { detail: null, teams: null }
  return { detail: stripped.charAt(0).toUpperCase() + stripped.slice(1), teams: null }
}

/**
 * What's happening now and what comes next, in order: the current phase, the phases still to come, and
 * any dated deadline the provider published that is still ahead.
 *
 * ⚠ WEEK-ONLY CALENDAR ROWS ARE LEFT OUT ON PURPOSE. leagueCalendar also emits "Trade deadline · Week 11"
 * and "Playoffs start · Week 15" from the same settings the timeline reads, so including them printed
 * each deadline twice. Only an event with a real date adds something the timeline cannot say.
 */
export function whatsNext(input: {
  timeline: ReadonlyArray<TimelinePhase> | null
  calendar: ReadonlyArray<LeagueCalendarEvent> | null
  currentWeek: number | null
  now?: Date
}): NextItem[] {
  const items: NextItem[] = []
  for (const p of oneRegularSeason(input.timeline ?? [])) {
    if (p.state === 'past') continue
    const span = weekSpan(p.when)
    const away = p.state === 'now' || span == null || input.currentWeek == null ? null : Math.max(0, span.start - input.currentWeek)
    const { detail, teams } = cleanDetail(p.detail)
    items.push({
      key: p.key,
      label: p.label,
      state: p.state,
      span,
      away,
      at: null,
      whenText: span ? null : p.when,
      detail,
      teams,
    })
  }
  const nowMs = (input.now ?? new Date()).getTime()
  for (const e of input.calendar ?? []) {
    if (!e.at) continue
    const ms = Date.parse(e.at)
    if (!Number.isFinite(ms) || ms < nowMs) continue
    items.push({ key: `cal-${e.key}`, label: e.label, state: 'future', span: null, away: null, at: e.at, whenText: null, detail: null, teams: null })
  }
  /*
   * 2026-11-14: the offseason waits until the playoffs are under way. In week 10, "Offseason · Rookie draft
   * order, keepers and taxi decisions" is a season away and only lengthens the list.
   */
  const playoffsAhead = items.some((i) => i.label === 'Playoffs' && i.state === 'future')
  return playoffsAhead ? items.filter((i) => i.label !== 'Offseason') : items
}

/**
 * The regular season as ONE row (2026-11-14).
 *
 * ⚠ seasonTimeline.ts splits the regular season around the trade deadline — "Regular season WK 1-12" and
 * "Run-in WK 13-14" — which is right for the data and wrong on this tab: "Your games left" calls weeks 13
 * and 14 the regular season, so the page contradicted itself, and "Run-in" is a word nobody uses. Here the
 * two halves become one "Regular season weeks 1–14"; the trade deadline stays its own row. The timeline
 * itself is untouched, because other screens read it.
 */
function oneRegularSeason(timeline: ReadonlyArray<TimelinePhase>): TimelinePhase[] {
  const early = timeline.find((p) => p.key === 'regular-early')
  const late = timeline.find((p) => p.key === 'regular-late')
  const a = early ? weekSpan(early.when) : null
  const b = late ? weekSpan(late.when) : null
  if (!early || !late || !a || !b) return [...timeline]
  const state: TimelinePhase['state'] =
    early.state === 'now' || late.state === 'now' ? 'now' : late.state === 'past' ? 'past' : 'future'
  const merged: TimelinePhase = { ...early, key: 'regular', when: b.end == null ? `week ${a.start} onward` : `WK ${a.start}-${b.end}`, state }
  return timeline.filter((p) => p !== late).map((p) => (p === early ? merged : p))
}

export type ScheduleHeadline =
  /** Nothing to say about this week — the screen keeps its plain title. */
  | { kind: 'none' }
  /** Your head-to-head game this week. `started` once either side has points. */
  | { kind: 'game'; week: number; opponent: string; you: number; them: number; started: boolean }
  /** No head-to-head game (an elimination league, a bye, preseason): the phase you are in and what is next. */
  | { kind: 'phase'; week: number | null; label: string; next: NextItem | null }

export function scheduleHeadline(input: {
  matchup: { week: number; you: { points: number }; opponent: { name: string; points: number } } | null
  currentWeek: number | null
  items: ReadonlyArray<NextItem>
}): ScheduleHeadline {
  const m = input.matchup
  if (m) {
    const started = m.you.points > 0 || m.opponent.points > 0
    return { kind: 'game', week: m.week, opponent: m.opponent.name, you: m.you.points, them: m.opponent.points, started }
  }
  const now = input.items.find((i) => i.state === 'now') ?? null
  const next = input.items.find((i) => i.state === 'future') ?? null
  if (!now && !next) return { kind: 'none' }
  return { kind: 'phase', week: input.currentWeek, label: (now ?? next)!.label, next: now ? next : null }
}
