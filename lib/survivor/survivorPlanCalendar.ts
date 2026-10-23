/**
 * The calendar a planned Survivor season runs on: which week an instant falls in, and the
 * `[start, end)` window of a week. NBA and NHL use the daily-sport calendar; NFL uses its own
 * Tuesday-to-Monday scoring weeks.
 *
 * ── 🛑 THE NFL DATES ARE MEASURED, NOT ASSUMED ─────────────────────────────────────────────────
 *
 * `nflWeekForDate` in lib/import-os/season.ts counts calendar weeks off September 4 and says so
 * itself: it is an estimate. A Survivor plan advances weeks and opens councils off this calendar,
 * so an estimate would open a vote on the wrong week. The 2026 dates below come from production
 * `SportsGame` (icy-field-51189449), regular-season rows only (`seasonType <> 'pre'`, from
 * 2026-09-01), measured 2026-10-22:
 *
 *   week  1  first kickoff 2026-09-10T00:20Z (Wed Sep 9, 8:20pm ET)   last 2026-09-15T00:15Z (Mon night)
 *   week  2  first kickoff 2026-09-18T00:15Z (Thu night)              last 2026-09-22T00:15Z (Mon night)
 *   …every week Thursday-night to Monday-night Eastern…
 *   week 18  first kickoff 2027-01-10T00:00Z (Sat Jan 9)               last 2027-01-11T02:00Z (Sun night)
 *
 * Preseason rows share week numbers 1–4 in that table (kickoffs from 2026-08-13), which is why
 * the measurement filters them out. Weeks are therefore Tuesday 06:00 Eastern to the next Tuesday
 * 06:00, anchored on Tuesday 2026-09-08, before week 1's Wednesday opener.
 *
 * Add a season only with the same two-source check: the published schedule AND production rows.
 */
import { dailySportWeekForInstant, resolveDailySportSeasonStart, resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'

export const SURVIVOR_PLAN_SPORTS = ['NBA', 'NHL', 'NFL'] as const
export type SurvivorPlanSport = (typeof SURVIVOR_PLAN_SPORTS)[number]

export function isSurvivorPlanSport(sport: unknown): sport is SurvivorPlanSport {
  return typeof sport === 'string' && (SURVIVOR_PLAN_SPORTS as readonly string[]).includes(sport)
}

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

/** Tuesday 06:00 Eastern before week 1. Year is the season's starting year. */
const NFL_WEEK_ONE_START_UTC: Readonly<Record<number, string>> = {
  2026: '2026-09-08T10:00:00.000Z',
}
/** The Eastern calendar day of the first regular-season kickoff, as a UTC-midnight date key. */
const NFL_OPENER_DAY_UTC: Readonly<Record<number, string>> = {
  2026: '2026-09-09T00:00:00.000Z',
}
const NFL_REGULAR_SEASON_WEEKS = 18

/** Published regular-season last days (Eastern). Year is the year the season BEGINS. */
const LAST_DAY: Readonly<Record<SurvivorPlanSport, Readonly<Record<number, string>>>> = {
  // https://pr.nba.com/2026-27-nba-regular-season-schedule/
  NBA: { 2026: '2027-04-11' },
  // https://www.nhl.com/news/nhl-announces-2026-27-regular-season-schedule
  NHL: { 2026: '2027-04-10' },
  // Week 18's Sunday-night game, 2027-01-11T02:00Z, is Sunday January 10 Eastern.
  NFL: { 2026: '2027-01-10' },
}

/** The regular season's last day, or null for a season not yet verified. */
export function planRegularSeasonLastDay(sport: SurvivorPlanSport, season: number): string | null {
  return LAST_DAY[sport]?.[season] ?? null
}

/** The opener as a UTC-midnight Eastern date key, or null for a season not yet verified. */
export function planSeasonOpener(sport: SurvivorPlanSport, season: number): string | null {
  if (sport === 'NFL') return NFL_OPENER_DAY_UTC[season] ?? null
  return resolveDailySportSeasonStart(sport, season)
}

/** The week `instant` falls in, or null before week 1. Past the last week it keeps counting. */
export function planWeekForInstant(sport: SurvivorPlanSport, season: number, instant: Date): number | null {
  if (sport !== 'NFL') return dailySportWeekForInstant(sport, season, instant)
  const anchor = NFL_WEEK_ONE_START_UTC[season]
  const t = instant.getTime()
  if (!anchor || Number.isNaN(t)) return null
  const start = Date.parse(anchor)
  if (t < start) return null
  return Math.floor((t - start) / WEEK_MS) + 1
}

/** The `[start, end)` window of `week`, or null when the calendar cannot tell. */
export function planWeekWindow(sport: SurvivorPlanSport, season: number, week: number): { start: Date; end: Date } | null {
  if (sport !== 'NFL') return resolveDailySportWeekWindow(sport, season, week)
  const anchor = NFL_WEEK_ONE_START_UTC[season]
  if (!anchor || !Number.isInteger(week) || week < 1 || week > NFL_REGULAR_SEASON_WEEKS) return null
  const start = new Date(Date.parse(anchor) + (week - 1) * WEEK_MS)
  return { start, end: new Date(start.getTime() + WEEK_MS) }
}
