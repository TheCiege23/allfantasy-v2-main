/**
 * How a divisions tournament's conference league is scheduled, so its weeks line up with the
 * tournament calendar (`divisionsCalendar` in ./engine).
 *
 * THE MAPPING (owner-approved):
 *   - The LEAGUE plays one round-robin regular season from week 1 through the tournament's LAST
 *     week (NFL 17; NBA `seasonLength − 1` on the engine's grid) and has NO league playoffs. Every
 *     team therefore has a scored `RedraftMatchup` row every week, bracket weeks included.
 *   - The TOURNAMENT's regular season is weeks 1 … `regularSeasonEnd` (= `seedingLocksAfter`).
 *     Seeding reads records and points from those weeks only (see ./weekScores).
 *   - Bracket round r is scored in calendar week `weeks[r-1].week`: each entrant's score is their
 *     own league matchup score that week, read by the tournament from Postgres. Their league
 *     opponent that week is irrelevant to the bracket; the league game still counts in the
 *     league's own table, which is why the league standings and the tournament standings diverge
 *     after `regularSeasonEnd`. That is intended: the league table is a side story, the
 *     tournament reads only what it needs.
 *
 * The plan is written to `League.settings[CONFERENCE_SEASON_PLAN_KEY]` when the league is
 * provisioned, and read where the league's first `RedraftSeason` is created
 * (lib/redraft/createdSeasonLength.ts and lib/redraft/finalizeDraftToRedraftSeason.ts) — the same
 * hook the survivor full-season plan and native best-ball tournaments use. Pure — no I/O.
 */
import { divisionsCalendar, type FormatSettings } from './engine'

export const CONFERENCE_SEASON_PLAN_KEY = 'tournament_divisions_season'

export type ConferenceSeasonPlan = {
  version: 1
  tournamentId: string
  /** Last week of the tournament's regular season; seeding locks after it. */
  regularSeasonEnd: number
  /** First bracket week. */
  bracketStartWeek: number
  /** The championship week, and the league's last scheduled week. */
  lastWeek: number
  /** Bracket weeks in round order: round r is `bracketWeeks[r - 1]`. */
  bracketWeeks: number[]
}

export function buildConferenceSeasonPlan(tournamentId: string, settings: Pick<FormatSettings, 'autoBids' | 'wildcardSpots' | 'seasonLength'>): ConferenceSeasonPlan {
  const cal = divisionsCalendar(settings)
  return {
    version: 1,
    tournamentId,
    regularSeasonEnd: cal.seedingLocksAfter,
    bracketStartWeek: cal.bracketStartWeek,
    lastWeek: cal.lastWeek,
    bracketWeeks: cal.weeks.map(w => w.week),
  }
}

/** The league's created season: every week through `lastWeek` is regular season, no playoffs. */
export function conferenceSeasonWeeks(plan: ConferenceSeasonPlan): { totalWeeks: number; playoffStartWeek: number } {
  return { totalWeeks: plan.lastWeek, playoffStartWeek: plan.lastWeek + 1 }
}

/** The plan stored on a league's settings, or null when absent or malformed. */
export function readConferenceSeasonPlan(settings: unknown): ConferenceSeasonPlan | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const raw = (settings as Record<string, unknown>)[CONFERENCE_SEASON_PLAN_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const p = raw as ConferenceSeasonPlan
  const int = (n: unknown): n is number => Number.isInteger(n)
  if (p.version !== 1 || typeof p.tournamentId !== 'string' || !p.tournamentId) return null
  if (!int(p.regularSeasonEnd) || !int(p.bracketStartWeek) || !int(p.lastWeek)) return null
  if (p.regularSeasonEnd < 1 || p.bracketStartWeek !== p.regularSeasonEnd + 1 || p.lastWeek < p.bracketStartWeek || p.lastWeek > 52) return null
  if (!Array.isArray(p.bracketWeeks) || !p.bracketWeeks.length || p.bracketWeeks[0] !== p.bracketStartWeek || p.bracketWeeks.at(-1) !== p.lastWeek) return null
  if (p.bracketWeeks.some((w, i) => !int(w) || (i > 0 && w !== p.bracketWeeks[i - 1]! + 1))) return null
  return p
}
