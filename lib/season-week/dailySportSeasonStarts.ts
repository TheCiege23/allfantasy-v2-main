/**
 * Day-level regular-season start dates for the DAILY sports (NBA, NHL).
 *
 * ── Why this file exists rather than a table ────────────────────────────────
 *
 * A daily sport's fantasy week is a DATE RANGE, because its feed carries no
 * usable week number — `weekOrRound` is 0 on every such row in production, the
 * NBA schedule feed writes 0 and the NHL one writes 500. Turning "week 3" into
 * a date range needs an anchor accurate to the DAY.
 *
 * `SeasonCalendar` is the table built for this and cannot answer it: it holds
 * MONTH granularity only (`{ monthStart, monthEnd }`), so it can say "October"
 * but not "the 20th", and it holds ZERO ROWS in production regardless.
 *
 * ── 🛑 THESE DATES ARE THE REGULAR-SEASON OPENER, NOT THE FIRST GAME ────────
 *
 * Preseason exclusion depends on that distinction and nothing else does it:
 * `SportsGame.seasonType` is NULL for every NBA and NHL row, and the
 * multi-sport ingest never reads `season_type`, so a preseason game is
 * otherwise indistinguishable from a regular-season one. Anchoring week 1 on
 * the opener excludes preseason as a PROPERTY of the window — a game played
 * before the anchor cannot fall inside any week.
 *
 * NHL preseason ran 19–27 September 2026; those games are real, ingested, and
 * must never score.
 *
 * ── How each date was established ───────────────────────────────────────────
 *
 * Each was taken from the league's published schedule AND independently
 * corroborated against game density in production `SportsGame`, because a date
 * that is merely asserted is the kind of thing that quietly mis-assigns an
 * entire season. Measured 2026-09-19 (`icy-field-51189449`):
 *
 *   NHL  2026-09-29   preseason 19–27 Sep, NO games on the 28th, then the 29th.
 *   NBA  2026-10-20   preseason to 17 Oct, NO games 18–19, then 2 on the 20th
 *                     (opening night) and a full 6-game slate on the 21st.
 *
 * The gap-then-resume shape matched the published opener for both sports.
 */

/** Keyed by the calendar year the season BEGINS — a 2026-27 season is `2026`. */
const REGULAR_SEASON_START_UTC: Readonly<Record<string, Readonly<Record<number, string>>>> = {
  NHL: {
    2026: '2026-09-29T00:00:00.000Z',
  },
  NBA: {
    2026: '2026-10-20T00:00:00.000Z',
  },
  // The first 2026-27 NCAAB game in SportsGame (espn_live; measured 2026-09-24). Opening day is
  // the first Monday of November. Weeks run Monday-to-Sunday from here.
  NCAAB: {
    2026: '2026-11-02T00:00:00.000Z',
  },
}

/**
 * The regular-season opener for a daily sport, or `null` when that season has
 * not been recorded here.
 *
 * 🛑 RETURNING `null` IS THE POINT. The caller declines and says so rather than
 * inventing an anchor: a guessed start date does not fail loudly, it silently
 * assigns every game to the wrong week and scores confidently wrong numbers.
 * Adding next season means adding a line here, deliberately, with the same
 * two-source check described above.
 */
export function resolveDailySportSeasonStart(
  sport: string | null | undefined,
  season: number | null | undefined,
): string | null {
  const key = String(sport ?? '').trim().toUpperCase()
  const bySeason = REGULAR_SEASON_START_UTC[key]
  if (!bySeason) return null

  const year = Number(season)
  if (!Number.isFinite(year)) return null

  return bySeason[year] ?? null
}

/** Seasons recorded for a sport, for diagnostics that want to say what IS known. */
export function knownDailySportSeasons(sport: string | null | undefined): number[] {
  const key = String(sport ?? '').trim().toUpperCase()
  return Object.keys(REGULAR_SEASON_START_UTC[key] ?? {})
    .map(Number)
    .sort((a, b) => a - b)
}
