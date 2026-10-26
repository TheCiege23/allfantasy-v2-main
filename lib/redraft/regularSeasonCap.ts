/**
 * A redraft or keeper league's regular season is at most 24 weeks. Pure and dependency-free: the
 * settings panels, the creation shape, the season builder and the save routes all import it.
 *
 * Every place the length can be set checks it here: the playoff start week (the regular season is the
 * weeks before it) on the settings patch, the commissioner schedule route's regular-season length and
 * playoff transition point, the redraft season POST, and creation's fitted bracket.
 *
 * ⚠ THE CAP ONLY BITES ON SMALL BRACKETS IN THE TWO LONGEST SEASONS. Every sport's default regular
 * season already fits (lib/sportConfig/dailySportSeasonShape.ts: NFL 14, NBA 22, MLB 23, NHL 24), but
 * creation places the final in the season's last week, so a smaller bracket starts later: an NHL 4-team
 * bracket (two rounds, two-week final) used to start in week 26 — a 25-week regular season — an NHL
 * 2-team final in week 27, and an MLB 2-team final in week 26. Capped, those brackets start in week 25
 * and the league's season ends with its final (`cappedSeasonWeeks`) instead of leaving the sport's last
 * weeks unplayed.
 *
 * Soccer is left out on purpose: its 38-matchweek season defaults to a 34-week regular season, and how
 * that should be cut is the owner's call, not a side effect of this cap.
 */

export const MAX_REGULAR_SEASON_WEEKS = 24
/** The latest week a capped league's playoffs can start. */
export const MAX_PLAYOFF_START_WEEK = MAX_REGULAR_SEASON_WEEKS + 1

const CAPPED_LEAGUE_TYPES: ReadonlySet<string> = new Set(['redraft', 'keeper'])
const CAPPED_SPORTS: ReadonlySet<string> = new Set(['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB'])

export const REGULAR_SEASON_CAP_MESSAGE = `The regular season can be at most ${MAX_REGULAR_SEASON_WEEKS} weeks.`
export const PLAYOFF_START_CAP_MESSAGE = `Playoffs can start no later than week ${MAX_PLAYOFF_START_WEEK} — the regular season can be at most ${MAX_REGULAR_SEASON_WEEKS} weeks.`

/** Does the 24-week cap apply to this league? `leagueType` null reads as redraft, the schema default. */
export function regularSeasonCapApplies(league: { leagueType?: string | null; sport?: unknown }): boolean {
  const type = String(league.leagueType ?? 'redraft').trim().toLowerCase()
  const sport = String(league.sport ?? '').trim().toUpperCase()
  return CAPPED_LEAGUE_TYPES.has(type) && CAPPED_SPORTS.has(sport)
}

/** The latest playoff start week to offer this league, or null when it is not capped. */
export function maxPlayoffStartWeekFor(league: { leagueType?: string | null; sport?: unknown }): number | null {
  return regularSeasonCapApplies(league) ? MAX_PLAYOFF_START_WEEK : null
}

/**
 * The season a capped league plays: the sport's weeks, or fewer when even a 24-week regular season
 * plus this bracket ends before the sport's last week. `bracketWeeks` 0 (no bracket) keeps the sport's.
 */
export function cappedSeasonWeeks(sportSeasonWeeks: number, bracketWeeks: number): number {
  if (!Number.isInteger(bracketWeeks) || bracketWeeks < 1) return sportSeasonWeeks
  return Math.min(sportSeasonWeeks, MAX_REGULAR_SEASON_WEEKS + bracketWeeks)
}

function wholeWeek(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** Null when `start` is an allowed playoff start week; the refusal otherwise. */
export function playoffStartWeekCapRefusal(start: unknown): string | null {
  const n = wholeWeek(start)
  return n != null && n > MAX_PLAYOFF_START_WEEK ? PLAYOFF_START_CAP_MESSAGE : null
}

/** Null when `weeks` is an allowed regular-season length; the refusal otherwise. */
export function regularSeasonLengthCapRefusal(weeks: unknown): string | null {
  const n = wholeWeek(weeks)
  return n != null && n > MAX_REGULAR_SEASON_WEEKS ? REGULAR_SEASON_CAP_MESSAGE : null
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/**
 * The settings-JSON copies of the regular-season length and the playoff start week a `settingsMerge`
 * could write. Each one is refused only when it CHANGES to a value past the cap, so re-saving a league
 * as it is never fails — native leagues store the sport's whole season in `regular_season_length`
 * (NHL 28), which reads as a regular season to nobody that matters but would fail a blind check.
 */
const MERGE_WEEK_PATHS: Array<{ path: string[]; kind: 'start' | 'length' }> = [
  { path: ['playoffStartWeek'], kind: 'start' },
  { path: ['playoff_start_week'], kind: 'start' },
  { path: ['schedule_playoff_transition_point'], kind: 'start' },
  { path: ['playoff_structure', 'playoff_start_week'], kind: 'start' },
  { path: ['playoffSettings', 'playoffStartWeek'], kind: 'start' },
  { path: ['playoffSettings', 'playoff_start_week'], kind: 'start' },
  { path: ['regular_season_length'], kind: 'length' },
  { path: ['regular_season_weeks'], kind: 'length' },
  { path: ['scheduleSettings', 'regularSeasonWeeks'], kind: 'length' },
]

function readPath(root: unknown, path: string[]): { present: boolean; value: unknown } {
  let node: unknown = root
  for (let i = 0; i < path.length; i++) {
    const obj = record(node)
    if (!obj || !Object.prototype.hasOwnProperty.call(obj, path[i])) return { present: false, value: undefined }
    node = obj[path[i]]
  }
  return { present: true, value: node }
}

/** Null when nothing in `merge` moves a capped league past 24 regular-season weeks; the refusal otherwise. */
export function settingsMergeCapRefusal(merge: unknown, storedSettings: unknown): string | null {
  if (!record(merge)) return null
  for (const { path, kind } of MERGE_WEEK_PATHS) {
    const next = readPath(merge, path)
    if (!next.present) continue
    const stored = readPath(storedSettings, path)
    if (stored.present && wholeWeek(stored.value) === wholeWeek(next.value)) continue
    const refusal = kind === 'start' ? playoffStartWeekCapRefusal(next.value) : regularSeasonLengthCapRefusal(next.value)
    if (refusal) return refusal
  }
  return null
}
