import { resolveLeagueCreationSeason } from '@/lib/season-week/leagueCreationSeason'
import { isNativePlatform } from '@/lib/dashboard/platform-label'

/**
 * The Dynasty Era "season clock": `Year N · YYYY`, in a dynasty league's header and its chat.
 *
 * ONE rule for both surfaces. They disagreed before: the header showed the season alone whenever
 * `startup_season` was unset, while chat fell back to the creation season, so one league could read
 * "2026 season" up top and "Year 3 · 2026" in chat.
 *
 * `N` counts seasons since the league's first season, the first being Year 1:
 *   - `League.season` — the season the league is playing. Rollover advances it.
 *   - The first season — the commissioner's `settings.startup_season` when set, else the season the
 *     league was stamped with at creation (`resolveLeagueCreationSeason(sport, createdAt)`), the same
 *     fallback `lib/draft-lottery/dynastyYearGuard.ts` uses when it has no RedraftSeason row.
 *     NATIVE LEAGUES ONLY: an imported league's row was created when it was imported, not when the
 *     league began, so a creation-season fallback there would guess "Year 1" for a league in its
 *     fifth season. Imported leagues without `startup_season` show the season alone.
 *
 * When the first season cannot be read, or comes out after the current season (a data problem, not
 * Year 0), `year` is null and the clock shows only the season — never a guessed year. The whole clock
 * is null only when the current season itself is unreadable.
 */
export type DynastySeasonClock = { year: number | null; season: number }

export type DynastySeasonClockSource = {
  season?: number | string | null
  sport?: string | null
  createdAt?: Date | string | null
  settings?: unknown
  /** League.platform. Absent or native → the creation-season fallback applies. */
  platform?: string | null
}

function asSeason(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{4}$/.test(value.trim()) ? Number(value) : NaN
  return Number.isInteger(n) && n > 1900 && n < 3000 ? n : null
}

function firstSeason(league: DynastySeasonClockSource): number | null {
  const settings = league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
    ? (league.settings as Record<string, unknown>)
    : {}
  const startup = asSeason(settings.startup_season)
  if (startup != null) return startup
  if (!league.createdAt || !league.sport || !isNativePlatform(league.platform)) return null
  const created = league.createdAt instanceof Date ? league.createdAt : new Date(league.createdAt)
  return Number.isNaN(created.getTime()) ? null : resolveLeagueCreationSeason(String(league.sport), created)
}

export function dynastySeasonClock(league: DynastySeasonClockSource): DynastySeasonClock | null {
  const season = asSeason(league.season)
  if (season == null) return null
  const first = firstSeason(league)
  const year = first != null && first <= season ? season - first + 1 : null
  return { year, season }
}
