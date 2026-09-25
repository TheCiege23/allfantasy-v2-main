/**
 * The games of one fantasy week, from `SportsGame`, as the week finalizer and the lineup lock both
 * need them: one row per fixture from the freshest feed, and — for a daily sport — selected by the
 * week's EASTERN-DAY date window rather than the feed's `week` column.
 *
 * Extracted from `readWeekSlate` (weekFinalizer.ts) so the lineup lock reads EXACTLY the games the
 * finalizer closes a week on; a lock that saw a different slate could leave a player movable after
 * a game the week is scored on. Kept free of the scoring engine so the lock can import it.
 */
import type { PrismaClient } from '@prisma/client'
import { LIVE_SCORE_SOURCES, pickFreshestSourceRows } from '@/lib/scores/liveSourceSelection'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'

/**
 * Sports whose week is a DATE WINDOW, closed by the same seven days the stat sync aggregates.
 *
 * 🛑 THE WINDOW COMES FROM A RECORDED SEASON OPENER, NEVER A GUESS. `resolveDailySportSeasonStart`
 * returns null for a season nobody has written down, and this refuses with
 * `season_start_unknown` rather than anchoring on January 1 — a guessed anchor does not fail
 * loudly, it assigns every game to the wrong week and seals confidently wrong scores.
 *
 * ⚠ NBA IS ABSENT ON PURPOSE AND IS ONE LINE AWAY. The mechanism below is sport-agnostic and
 * NBA's opener is already recorded (2026-10-20), but its season has not started, so no NBA
 * slate or stat row has been checked against this path. Adding it is a measurement, not an
 * edit — the same standard `SEASON_CAPABLE_SPORTS` sets.
 */
export const DATE_WINDOWED_SPORTS: readonly string[] = ['NHL', 'NCAAB']

/**
 * Date-windowed sports whose slate comes from the Rolling Insights season schedule
 * (lib/sports-data/riSeasonSchedule.ts), because every schedule in `SportsGame` is INCOMPLETE for
 * them. NCAAB, measured 2026-09-24: thesportsdb 2025-26 stops at a 3,000-game cap on 02-04, and
 * week 1 lists 243 games against 310 in our game logs; RI's schedule matches the logs exactly.
 * A slate short a game can seal a week whose stats miss that game — so for these sports an
 * unsynced schedule is an EMPTY slate, which refuses, never a fallback to the partial feeds.
 */
export const RI_SCHEDULE_SLATE_SPORTS: readonly string[] = ['NCAAB']

export type WeekGameRow = {
  status: string | null
  startTime: Date | null
  source: string | null
  fetchedAt: Date | null
  season: number | null
  week: number | null
  homeTeam: string | null
  awayTeam: string | null
}

export async function readWeekGames(
  prisma: PrismaClient,
  args: {
    sport: string
    season: number
    week: number
    seasonType: 'regular' | 'postseason'
    now?: Date
    /** A daily sport's week, as the Eastern-day window the stat sync aggregates over. */
    dateWindow?: { start: Date; end: Date } | null
  },
): Promise<WeekGameRow[]> {
  const windowed = args.dateWindow ?? null
  /*
   * 🛑 THE WINDOW IS EASTERN DAYS, AND `startTime` IS A UTC INSTANT — SELECTING ON THE INSTANT
   * PUTS A THIRD OF THE SEASON IN THE WRONG WEEK.
   *
   * `player_game_stats.game_date` stores the EASTERN calendar day a game was played (#1194),
   * and the stat sync buckets by it. A slate that filtered `startTime` against the same bounds
   * would bucket by UTC instead, and the two halves would disagree about which games belong to
   * the week. Measured on production 2026-09-24: 957 of 1,415 NHL 2026 games — 67.6% — start
   * after UTC midnight, because a 7-10pm Eastern puck drop is the NEXT UTC day. Week 1 holds
   * 42 games by UTC instant against 43 by Eastern day.
   *
   * ⚠ THE UTC WINDOW MISSES GAMES RATHER THAN OVER-COUNTING THEM, WHICH IS THE WORSE
   * DIRECTION: a slate short one game can report itself complete and SEAL a week whose stats
   * include a game it never checked. (An earlier note here said 39, from a SQL check that
   * converted the wrong way — `startTime` is `timestamp without time zone`, so
   * `AT TIME ZONE 'America/New_York'` INTERPRETS it as Eastern and shifts it TO UTC. Declare
   * the column UTC first: `(x AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York'`.)
   *
   * So the query over-selects by six hours and the exact membership test happens below, on
   * `easternCalendarDay` — the same helper, and therefore the same DST handling, that wrote
   * those `game_date` values.
   */
  const EASTERN_OVERSELECT_MS = 6 * 60 * 60 * 1000
  const rawRows = (await prisma.sportsGame.findMany({
    where: {
      sport: args.sport,
      season: args.season,
      ...(windowed
        ? { startTime: { gte: windowed.start, lt: new Date(windowed.end.getTime() + EASTERN_OVERSELECT_MS) } }
        : { week: args.week }),
      // Only ranked feeds may answer: an unranked one (cfbd donates kickoff times and has no
      // live status at all) would contribute permanent "unfinished" rows.
      source: { in: [...LIVE_SCORE_SOURCES] },
      /*
       * Same discriminator the live provider uses: preseason week 1 and regular week 1
       * share a number, and rows predating the column are overwhelmingly regular season,
       * so NULL joins the regular slate and never the postseason one.
       */
      ...(args.seasonType === 'regular'
        ? { OR: [{ seasonType: 'regular' }, { seasonType: null }] }
        : { seasonType: args.seasonType }),
    },
    select: {
      status: true,
      startTime: true,
      source: true,
      fetchedAt: true,
      season: true,
      week: true,
      homeTeam: true,
      awayTeam: true,
    },
  })) as WeekGameRow[]

  /*
   * ⚠ A WINDOWED READ MUST DROP `week` BEFORE SELECTION, OR THE NOISE BECOMES THE GROUPING.
   * `pickFreshestSourceRows` slices on `season:week` and picks one source PER SLICE. NHL rows
   * inside one seven-day window carry several of those junk week values, so the selection
   * would split the window into arbitrary groups. Rows with a null week share a single slice —
   * which that module documents as the original whole-call behaviour, and is exactly right for
   * a caller that did not group by week in the first place.
   */
  const inWindow = windowed
    ? rawRows.filter((row) => {
        const day = easternCalendarDay(row.startTime)
        return day != null && day >= windowed.start && day < windowed.end
      })
    : rawRows
  const selectable: WeekGameRow[] = windowed ? inWindow.map((row) => ({ ...row, week: null })) : inWindow
  return pickFreshestSourceRows(selectable, (args.now ?? new Date()).getTime())
}
