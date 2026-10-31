/**
 * The Dynasty Era "season clock": `Year N · YYYY` in a dynasty league's header.
 *
 * Real data only. `N` is derived from two stored fields and nothing else:
 *   - `League.season` — the season the league is playing. Rollover advances it
 *     (`ensureNextRedraftSeasonShell` writes `season: nextSeasonYear`).
 *   - `settings.startup_season` — the founding season, stamped once when a dynasty league is
 *     created (`app/api/league/create`) and never rewritten. `lib/draft-lottery/dynastyYearGuard.ts`
 *     reads the same key as "the league's first season", so the two can never disagree.
 *
 * When either is missing or the pair is inconsistent (startup after the current season), `year` is
 * null and the clock shows only the season — never a guessed year. Imported leagues carry no
 * `startup_season`, so they show the season alone.
 */
export type DynastySeasonClock = { year: number | null; season: number }

function asSeason(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{4}$/.test(value.trim()) ? Number(value) : NaN
  return Number.isInteger(n) && n >= 1900 && n <= 3000 ? n : null
}

export function dynastySeasonClock(league: { season?: number | string | null; settings?: Record<string, unknown> | null }): DynastySeasonClock | null {
  const season = asSeason(league.season)
  if (season == null) return null
  const raw = league.settings?.startup_season
  // A number only, exactly as dynastyYearGuard reads it.
  const startup = typeof raw === 'number' ? asSeason(raw) : null
  const year = startup != null && startup <= season ? season - startup + 1 : null
  return { year, season }
}
