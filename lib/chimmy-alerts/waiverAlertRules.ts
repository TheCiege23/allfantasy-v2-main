/**
 * CHIMMY'S WAIVER ALERT, SPORT BY SPORT — every rule the non-NFL alert runs on, in one place.
 *
 * Owner's decision 2026-09-29: extend the waiver alert beyond the NFL with per-sport rules. The
 * NFL's own rule is NOT here and does not move: it lives in `waiverCheck.ts` (Tuesday window keyed
 * on the week's first kickoff, WAIVER_CHECK_MIN_GAIN projected points for the week) and stays byte
 * for byte what it was. This file only ADDS the sports the /core Waivers board prices per game
 * (`lib/core-app/waiversBoardSports.ts`).
 *
 * Tune a number here and nowhere else. Each field says what it is in the unit it is measured in.
 *
 * ── 🛑 EVERY THRESHOLD IS POINTS PER GAME, IN THE SECTION'S OWN UNITS ─────────────────────────
 * The sections price a season per-game rate: NBA · NCAAB · NHL · MLB on AllFantasy's default
 * (DraftKings-convention) category scoring, NCAAF under the league's own scoring. None of them is a
 * weekly projection, so no rule here is "points this week" and no message built from it says so.
 *
 * ── 🛑 A SPORT WITH NO RULE NEVER ALERTS ──────────────────────────────────────────────────────
 * Soccer has no producer (`waiverSportPlan` → `none`) and so has no rule. The runner also refuses
 * any section that is not `state: 'ok'` on a per-game basis, so a rule added here for a sport
 * without a producer still sends nothing.
 *
 * ── HOW OFTEN, AT MOST ────────────────────────────────────────────────────────────────────────
 * ONE message per user per US Eastern day across every sport below (the NFL's Tuesday message is
 * separate and unchanged), and only when a pick clears its sport's threshold. Every window opens at
 * the same Eastern hour on purpose, so a user in three sports gets one message naming all three,
 * not three messages. A pick already named in the last SPORT_WAIVER_ALERT_REPEAT_QUIET_DAYS days is
 * not named again: "the same add again" is the message that teaches people to ignore the next one.
 */

const HOUR_MS = 60 * 60 * 1000

export type SportWaiverAlertCadence =
  /** Any US Eastern day on which the sport has a game. */
  | { kind: 'daily' }
  /** One Eastern weekday (0 = Sunday … 6 = Saturday), when the sport has a game in the next week. */
  | { kind: 'weekly'; weekdayEt: 0 | 1 | 2 | 3 | 4 | 5 | 6 }

export type SportWaiverAlertSeason =
  /**
   * In season from the regular-season opener recorded in `lib/season-week/dailySportSeasonStarts.ts`
   * for `regularSeasonDays` days. The recorded opener is what keeps PRESEASON out: NBA and NHL games
   * carry no `seasonType`, so a schedule read alone cannot tell a preseason game from a real one.
   * A season with no recorded opener is out of season — the safe failure, as it is for scoring.
   * Leagues are matched on `League.season` = the year the season begins (2026 for 2026-27).
   */
  | { kind: 'recorded_opener'; regularSeasonDays: number }
  /**
   * In season while a `seasonType: 'regular'` game is scheduled in the next `lookaheadDays` days.
   * For a sport whose season sits inside one calendar year, so `League.season` = the Eastern year.
   */
  | { kind: 'regular_season_games'; lookaheadDays: number }

export type SportWaiverAlertRule = {
  /** `LeagueSport` / `SportsGame.sport` code. */
  sport: 'NBA' | 'NCAAB' | 'NHL' | 'MLB' | 'NCAAF'
  /** Off sends nothing for this sport and reads nothing for it either. */
  enabled: boolean
  cadence: SportWaiverAlertCadence
  /** The window opens at this US Eastern hour (0–23)… */
  opensAtHourEt: number
  /** …and closes at this one (exclusive). */
  closesAtHourEt: number
  /** And closes this long before the day's first game, whichever comes first. */
  closesBeforeFirstGameMs: number
  season: SportWaiverAlertSeason
  /** A swap must gain at least this many points PER GAME (section units) to be worth a claim. */
  minGainPerGame: number
}

/**
 * The rules. Order is the order sports appear in a message.
 *
 * Why these numbers (DraftKings-convention default scoring for the four category sports):
 *
 *   NBA    4.0/g  A rotation player scores ~15–30 DK/g, so 4 is a real role change (≈3 points and a
 *                 rebound a night), and at ~3.5 games a week it is ~14 points — well above noise.
 *   NCAAB  5.0/g  Same rules as the NBA, but college rates rest on fewer games with wider swings and
 *                 teams play ~2 games a week, so it takes more to be worth a claim.
 *   NHL    2.0/g  Skaters score ~6–12 DK/g (a goal is 8.5), so 2 is ~20% of a typical skater — about
 *                 one extra shot on goal and a bit of scoring every night, ~7 points a week.
 *   MLB    2.0/g  Hitters score ~7–10 DK/g; 2 a game over ~6 games a week is ~12 points.
 *                 ⚠ DORMANT until an MLB opener is recorded in dailySportSeasonStarts.ts (none is,
 *                 deliberately — see that file), exactly like MLB week scoring.
 *   NCAAF  3.0/g  League scoring, one game a week, so per game ≈ per week: the NFL's 2-point bar,
 *                 raised by one because a college season rate swings harder with the opponent.
 *
 * Windows: the daily sports go out between 10:00 and 13:00 Eastern on a day with games, and never
 * within an hour of the day's first game — a morning message, not a 3am one, and never after the
 * slate starts locking. College football goes out on Tuesday, the usual college waiver day, in the
 * same morning window (no league's real waiver day is on file — see waiverCheck.ts).
 */
export const SPORT_WAIVER_ALERT_RULES: readonly SportWaiverAlertRule[] = [
  {
    sport: 'NCAAF',
    enabled: true,
    cadence: { kind: 'weekly', weekdayEt: 2 },
    opensAtHourEt: 10,
    closesAtHourEt: 13,
    closesBeforeFirstGameMs: HOUR_MS,
    season: { kind: 'regular_season_games', lookaheadDays: 7 },
    minGainPerGame: 3,
  },
  {
    sport: 'NBA',
    enabled: true,
    cadence: { kind: 'daily' },
    opensAtHourEt: 10,
    closesAtHourEt: 13,
    closesBeforeFirstGameMs: HOUR_MS,
    // Opening night (20 Oct 2026) to the last regular-season night in mid-April.
    season: { kind: 'recorded_opener', regularSeasonDays: 175 },
    minGainPerGame: 4,
  },
  {
    sport: 'NCAAB',
    enabled: true,
    cadence: { kind: 'daily' },
    opensAtHourEt: 10,
    closesAtHourEt: 13,
    closesBeforeFirstGameMs: HOUR_MS,
    // Opening day (2 Nov 2026) to Selection Sunday; fantasy college basketball is over by then.
    season: { kind: 'recorded_opener', regularSeasonDays: 133 },
    minGainPerGame: 5,
  },
  {
    sport: 'NHL',
    enabled: true,
    cadence: { kind: 'daily' },
    opensAtHourEt: 10,
    closesAtHourEt: 13,
    closesBeforeFirstGameMs: HOUR_MS,
    // Opener (29 Sep 2026) to the end of the regular season in mid-April.
    season: { kind: 'recorded_opener', regularSeasonDays: 200 },
    minGainPerGame: 2,
  },
  {
    sport: 'MLB',
    enabled: true,
    cadence: { kind: 'daily' },
    opensAtHourEt: 10,
    closesAtHourEt: 13,
    closesBeforeFirstGameMs: HOUR_MS,
    // Late March to late September. Dormant until the opener is recorded — see above.
    season: { kind: 'recorded_opener', regularSeasonDays: 186 },
    minGainPerGame: 2,
  },
]

/** Picks named in one message, across every sport; the rest are a tap away on the Waivers board. */
export const SPORT_WAIVER_ALERT_MAX_PICKS = 5

/** A pick (same league, same add, same drop) named within this many days is not named again. */
export const SPORT_WAIVER_ALERT_REPEAT_QUIET_DAYS = 3

/** The rule for a sport, or null — no rule, no alert. */
export function sportWaiverAlertRule(sport: string | null | undefined): SportWaiverAlertRule | null {
  const s = String(sport ?? '').trim().toUpperCase()
  return SPORT_WAIVER_ALERT_RULES.find((r) => r.sport === s) ?? null
}
