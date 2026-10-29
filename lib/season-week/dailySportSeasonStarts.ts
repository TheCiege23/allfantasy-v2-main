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
  // one game on that Eastern day, followed by the March 26 slate. The March 25–31 player stats
  // were backfilled in production. MLB announced March 24 as 2027 Opening Night; the matchup
  // is still TBD, so the current game feed starts March 25. Anchor on the announced opener so
  // the eventual Opening Night game lands in week 1 when the feed publishes it.
  MLB: {
    2026: '2026-03-25T00:00:00.000Z',
    2027: '2027-03-24T00:00:00.000Z',
  },
  // The 2026-27 regular season opens in Rome on November 1 (Notre Dame v Villanova),
  // one day before the domestic slate. The official announcement and current RI cache agree.
  // Evidence: docs/readiness/multisport-blockers-2026-10-05.md. Shared seven-day windows
  // must include that opener; starting November 2 silently excluded it from scoring.
  NCAAB: {
    2026: '2026-11-01T00:00:00.000Z',
  },
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

// NBA fantasy periods follow Eastern calendar days. A fixed seven-day UTC offset
// moves the boundary by an hour when daylight saving time changes in November.
function nbaEasternWeekDay(season: number, week: number): Date | null {
  // Through the resolver, not the table: a schedule-derived opener (see below) must reach the NBA
  // Eastern-day arithmetic too, or a year-2 dynasty season would resolve windows but not weeks.
  const opener = resolveDailySportSeasonStart('NBA', season)
  if (!opener) return null
  const day = new Date(Date.parse(opener) + (week - 1) * 7 * DAY_MS)
  const noon = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 12))
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
    .formatToParts(noon).find(part => part.type === 'timeZoneName')?.value ?? ''
  const offsetHours = Number(zone.match(/^GMT([+-]\d+)$/)?.[1])
  if (!Number.isFinite(offsetHours)) return null
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - offsetHours * 3_600_000)
}

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
  // These bounds are UTC-midnight DATE keys for game_date and easternCalendarDay,
  // not instants. The inverse below uses actual Eastern-midnight instants to
  // classify a kickoff, including the daylight-saving transition.
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
  if (String(sport ?? '').toUpperCase() === 'NBA' && Number.isInteger(Number(season))) {
    const anchor = nbaEasternWeekDay(Number(season), 1)
    if (anchor) {
      if (t < anchor.getTime()) return null
      const approximate = Math.floor((t - anchor.getTime()) / (7 * DAY_MS)) + 1
      // DST can move the true edge an hour relative to elapsed UTC time.
      for (const week of [approximate - 1, approximate, approximate + 1]) {
        if (week < 1) continue
        const start = nbaEasternWeekDay(Number(season), week)
        const end = nbaEasternWeekDay(Number(season), week + 1)
        if (start && end && t >= start.getTime() && t < end.getTime()) return week
      }
      return null
    }
  }
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
 * Openers DERIVED from the stored schedule, for seasons the curated table above does not list yet.
 *
 * 🛑 WHY THIS EXISTS: DYNASTY LEAGUES OUTLIVE THE TABLE. A dynasty league rolls into `season + 1`
 * every year (`ensureNextRedraftSeasonShell.ts`, `carryDynastyRosters.ts`). With only NBA/NHL 2026
 * and MLB 2026-27 recorded, a year-2 NBA/NHL dynasty league (the 2027-28 season) had no anchor: the
 * week roller held at `NO_WEEK_SIGNAL`, the stat sync and the finalizer declined, and the league
 * never activated or scored — every such league, every year, until someone added a line by hand.
 * MLB hits the same wall at 2028.
 *
 * The curated table stays AUTHORITATIVE: a curated year never consults this cache, and a derived
 * entry can never be recorded over one. A derived entry is only ever the earliest game that the
 * stored schedule EXPLICITLY labels regular season (`deriveDailySportSeasonStart.ts`) — a fact
 * read from Postgres, not a guess. The async deriver writes it here because most readers of this
 * module are synchronous and one is client-reachable (the lineup lock), so this module cannot read
 * the database itself. The async entry points that roll, score and lock weeks prime it first; a
 * reader in a process that has not primed sees `null` exactly as before — it declines, it never
 * guesses.
 *
 * An ESTIMATE (`estimateDailySportSeasonStart`) is deliberately NOT stored here and NOT returned by
 * `resolveDailySportSeasonStart`; see its own comment.
 */
const DERIVED_REGULAR_SEASON_START_UTC = new Map<string, string>()

const derivedKey = (sport: string, season: number) => `${sport}:${season}`

/**
 * Record (or, with `null`, forget) a schedule-derived opener. Refused for a curated season, for
 * soccer (its weeks are a curated gameweek list, so an arithmetic anchor would be wrong), and for
 * any sport with no curated opener at all (an NFL "opener" here would flip it onto the daily path).
 */
export function recordDerivedDailySportSeasonStart(
  sport: string | null | undefined,
  season: number,
  opener: string | null,
): void {
  const key = String(sport ?? '').trim().toUpperCase()
  if (!estimateDailySportSeasonStart(key, season)) return
  if (opener && !Number.isNaN(Date.parse(opener))) DERIVED_REGULAR_SEASON_START_UTC.set(derivedKey(key, season), opener)
  else DERIVED_REGULAR_SEASON_START_UTC.delete(derivedKey(key, season))
}

/** Test seam: forget every derived opener. */
export function clearDerivedDailySportSeasonStarts(): void {
  DERIVED_REGULAR_SEASON_START_UTC.clear()
}

/** Whether the hand-curated, two-source-checked table lists this season. */
export function isCuratedDailySportSeason(
  sport: string | null | undefined,
  season: number | null | undefined,
): boolean {
  const key = String(sport ?? '').trim().toUpperCase()
  const year = Number(season)
  return Number.isFinite(year) && Boolean(REGULAR_SEASON_START_UTC[key]?.[year])
}

/**
 * A rough opener for a season AFTER the latest curated one: the latest curated opener's month and
 * day in the target year, moved to the nearest same weekday (NBA and NHL 2026 opened on a Tuesday,
 * MLB 2027 on a Wednesday). E.g. NBA 2026-10-20 (Tue) → 2027-10-19 (Tue).
 *
 * ⚠ IT IS AN ESTIMATE AND IS NEVER AN ANCHOR. Openers move by a week or more year to year (NHL 2026
 * opened 29 September, earlier than usual), and a week window anchored on a wrong day scores
 * confidently wrong numbers — the failure the `null` contract below exists to prevent. It only
 * centres the deriver's search window and tells a human roughly when the opener is expected while
 * the schedule is unpublished; every caller that receives one is told `estimated: true`.
 *
 * `null` for soccer (curated gameweek list), for seasons at or before the latest curated one, and
 * for sports with no curated opener.
 */
export function estimateDailySportSeasonStart(
  sport: string | null | undefined,
  season: number | null | undefined,
): string | null {
  const key = String(sport ?? '').trim().toUpperCase()
  const year = Number(season)
  if (key === 'SOCCER' || !Number.isInteger(year)) return null
  const known = knownDailySportSeasons(key)
  const latest = known[known.length - 1]
  if (latest == null || year <= latest) return null
  const base = new Date(REGULAR_SEASON_START_UTC[key]![latest]!)
  const anniversary = new Date(Date.UTC(year, base.getUTCMonth(), base.getUTCDate()))
  // Signed shift in [-3, +3] days that lands on the base opener's weekday.
  const shift = ((base.getUTCDay() - anniversary.getUTCDay() + 10) % 7) - 3
  return new Date(anniversary.getTime() + shift * DAY_MS).toISOString()
}

/**
 * The regular-season opener for a daily sport, or `null` when that season has
 * not been recorded here — curated, or derived from the labelled schedule above.
 *
 * 🛑 RETURNING `null` IS THE POINT. The caller declines and says so rather than
 * inventing an anchor: a guessed start date does not fail loudly, it silently
 * assigns every game to the wrong week and scores confidently wrong numbers.
 * The curated table wins; a schedule-derived opener fills a later season only
 * once the stored schedule labels that season's regular-season games. Adding a
 * line to the table, with the two-source check described above, still overrides
 * both — do that for any season whose opener is known.
 */
export function resolveDailySportSeasonStart(
  sport: string | null | undefined,
  season: number | null | undefined,
): string | null {
  const key = String(sport ?? '').trim().toUpperCase()
  const year = Number(season)
  if (!Number.isFinite(year)) return null

  const curated = REGULAR_SEASON_START_UTC[key]?.[year]
  if (curated) return curated
  return DERIVED_REGULAR_SEASON_START_UTC.get(derivedKey(key, year)) ?? null
}

/**
 * CURATED seasons recorded for a sport, for diagnostics that want to say what IS known. Derived
 * openers are not listed: they live per process and exist only once something has primed them.
 */
export function knownDailySportSeasons(sport: string | null | undefined): number[] {
  const key = String(sport ?? '').trim().toUpperCase()
  return Object.keys(REGULAR_SEASON_START_UTC[key] ?? {})
    .map(Number)
    .sort((a, b) => a - b)
}
