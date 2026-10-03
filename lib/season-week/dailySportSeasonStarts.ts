/**
 * Day-level regular-season start dates for the DAILY sports.
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
import { weekWindowFromSeasonStart } from '@/lib/scoring-runtime/dailySportStatNormalization'

/** Keyed by the calendar year the season BEGINS — a 2026-27 season is `2026`. */
const REGULAR_SEASON_START_UTC: Readonly<Record<string, Readonly<Record<number, string>>>> = {
  NHL: {
    2026: '2026-09-29T00:00:00.000Z',
  },
  NBA: {
    2026: '2026-10-20T00:00:00.000Z',
  },
  // MLB's published 2026 Opening Night was March 25 (US Eastern). Production SportsGame has
  // one game on that Eastern day, followed by the March 26 slate. This anchors historical
  // scoring windows; it does not by itself certify MLB as season-capable. The first week of
  // player_game_stats still needs a March 25–31 backfill before that gate can be widened.
  MLB: {
    2026: '2026-03-25T00:00:00.000Z',
  },
  // The first 2026-27 NCAAB game in SportsGame (espn_live; measured 2026-09-24). Opening day is
  // the first Monday of November. Weeks run Monday-to-Sunday from here.
  NCAAB: {
    2026: '2026-11-02T00:00:00.000Z',
  },
  /*
   * MLB is keyed by its calendar year. Add the 2027 regular-season opener only after the published
   * schedule is corroborated by production game rows. Until then 2027 weeks decline with
   * `season_start_unknown` rather than borrowing 2026's anchor.
   */
  // SOCCER (EPL + La Liga + Serie A, one pool): the Friday of the first weekend — La Liga opened Sat
  // 15 Aug 2026, the Premier League Fri 21 Aug, Serie A Sat 22 Aug (Rolling Insights season schedules,
  // fixtures/schedule-season.SOCCER.*.json; TheSportsDB's EPL rows in SportsGame agree on the 21st).
  // Soccer does not use seven-day arithmetic from here — see SOCCER_GAMEWEEK_STARTS below.
  SOCCER: {
    2026: '2026-08-14T00:00:00.000Z',
  },
}

/**
 * 🛑 SOCCER WEEKS ARE GAMEWEEKS: ONLY THE SEVEN-DAY WINDOWS THAT HOLD A GAME.
 *
 * Every other daily sport plays every week, so "week N" is the Nth seven days from the opener. Soccer
 * stops for international breaks — in 2026-27 four Friday-to-Thursday windows hold no game in any of
 * the three leagues (25 Sep – 8 Oct, 13–19 Nov, 26 Mar – 1 Apr). The finalizer refuses an empty slate
 * (`no_games_on_slate`), so an arithmetic week there could never seal and every soccer league would
 * sit on it for good.
 *
 * So gameweek N is the Nth window below. Each runs Friday to Thursday on US Eastern days, which keeps
 * a weekend round (Friday to Monday) whole and folds the following midweek round into it — a double
 * gameweek, as FPL does it. Derived from the Rolling Insights season schedules for all three leagues
 * (1,140 fixtures, 38 non-empty windows — the leagues' own 38 rounds). A fixture later moved INTO an
 * empty window belongs to no gameweek and is not scored; re-derive this list if that happens.
 */
const GAMEWEEK_STARTS: Readonly<Record<string, Readonly<Record<number, readonly string[]>>>> = {
  SOCCER: {
    2026: [
      '2026-08-14', '2026-08-21', '2026-08-28', '2026-09-04', '2026-09-11', '2026-09-18', '2026-10-09',
      '2026-10-16', '2026-10-23', '2026-10-30', '2026-11-06', '2026-11-20', '2026-11-27', '2026-12-04',
      '2026-12-11', '2026-12-18', '2026-12-25', '2027-01-01', '2027-01-08', '2027-01-15', '2027-01-22',
      '2027-01-29', '2027-02-05', '2027-02-12', '2027-02-19', '2027-02-26', '2027-03-05', '2027-03-12',
      '2027-03-19', '2027-04-02', '2027-04-09', '2027-04-16', '2027-04-23', '2027-04-30', '2027-05-07',
      '2027-05-14', '2027-05-21', '2027-05-28',
    ],
  },
}

const DAY_MS = 86_400_000

function gameweekStarts(sport: string | null | undefined, season: number | null | undefined): readonly string[] | null {
  const key = String(sport ?? '').trim().toUpperCase()
  const year = Number(season)
  if (!Number.isFinite(year)) return null
  return GAMEWEEK_STARTS[key]?.[year] ?? null
}

/**
 * The `[start, end)` window of week `week` for a daily sport — the ONE place a week number becomes
 * dates, for the stat sync and the finalizer alike. A gameweek sport reads its list; every other sport
 * is seven-day arithmetic from its recorded opener. `null` means "cannot tell" and callers decline.
 */
export function resolveDailySportWeekWindow(
  sport: string | null | undefined,
  season: number | null | undefined,
  week: number,
): { start: Date; end: Date } | null {
  if (!Number.isInteger(week) || week < 1) return null
  const starts = gameweekStarts(sport, season)
  if (starts) {
    const day = starts[week - 1]
    if (!day) return null
    const start = new Date(`${day}T00:00:00.000Z`)
    return { start, end: new Date(start.getTime() + 7 * DAY_MS) }
  }
  return weekWindowFromSeasonStart(resolveDailySportSeasonStart(sport, season), week)
}

/**
 * The week an instant falls in, for relabelling a schedule (the week roller) — the inverse of
 * {@link resolveDailySportWeekWindow}. `null` = before the opener, or inside a gameweek gap.
 */
export function dailySportWeekForInstant(
  sport: string | null | undefined,
  season: number | null | undefined,
  instant: Date,
): number | null {
  const t = instant.getTime()
  if (Number.isNaN(t)) return null
  const starts = gameweekStarts(sport, season)
  if (starts) {
    for (let i = 0; i < starts.length; i++) {
      const s = Date.parse(`${starts[i]}T00:00:00.000Z`)
      if (t >= s && t < s + 7 * DAY_MS) return i + 1
    }
    return null
  }
  const opener = resolveDailySportSeasonStart(sport, season)
  if (!opener) return null
  const anchor = Date.parse(opener)
  if (t < anchor) return null
  return Math.floor((t - anchor) / (7 * DAY_MS)) + 1
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
