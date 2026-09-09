import { prisma } from '@/lib/prisma'

/**
 * The league's activity trend, read from the behavioural snapshot series.
 *
 * 🛑 THIS DOES NOT READ `intelligence_league_snapshot_history`, AND THE DISTINCTION IS THE WHOLE
 * REASON THIS FILE EXISTS. There are two snapshot stores and they are not interchangeable:
 *
 *   - `intelligence_league_snapshot_history` — what `/api/v1/intelligence/league/trend` reads, and
 *     the source of the engagement-score direction arrow. P0 gave it a scheduled writer; measured
 *     2026-09-09 it holds **0 rows**, because the capture cron last ran before that deploy went out.
 *     It will begin filling on the next run, and a trend needs two points, so a chart built on it
 *     today would render an empty frame for every league on the platform.
 *   - `decision_os_behavioral_snapshot` — written by the same job for months. **3,016 league-scope
 *     rows across 281 leagues over 30 daily periods.** Real, dense, and already there.
 *
 * So this chart reads the store that has data rather than the one whose name matches the feature.
 * When the history store has accumulated, the engagement-score trend becomes a second, different
 * series — not a replacement for this one.
 */

export interface LeagueActivityTrendPoint {
  /** The capture date (`periodKey`), `YYYY-MM-DD`. */
  date: string
  /**
   * Events inside the rolling lookback window AS OF that capture — deliberately not named
   * `eventCount`.
   *
   * 🛑 IT IS NOT "EVENTS THAT DAY", AND READING IT THAT WAY INVERTS THE CHART'S MEANING. Each
   * capture counts everything in the trailing `lookbackDays`, so the series falls whenever old
   * events age out faster than new ones arrive — a league can post activity every week and still
   * trend down. Measured on the reference league: 95 → 77 across 30 captures, with real events
   * throughout. The name carries the semantics because the label on the chart is the only other
   * place they could live, and a caller should not be able to plot this as a daily count by
   * accident.
   */
  windowedEventCount: number
}

export interface LeagueActivityTrend {
  points: LeagueActivityTrendPoint[]
  /** The window each point counts over. Read from the rows, never assumed to be the env default. */
  lookbackDays: number | null
}

/** Captures to read. 30 is what the store currently holds; asking for more is harmless. */
const MAX_POINTS = 30

export async function readLeagueActivityTrend(leagueId: string): Promise<LeagueActivityTrend> {
  try {
    const rows = await prisma.decisionOsBehavioralSnapshot.findMany({
      /*
       * `scope: 'league'` matters: the same table holds 17,762 MANAGER-scope rows, and including
       * them would sum a dozen managers' windows into one wildly inflated league figure.
       */
      where: { leagueId, scope: 'league' },
      select: { periodKey: true, eventCount: true, lookbackDays: true },
      orderBy: { periodKey: 'desc' },
      take: MAX_POINTS,
    })

    // Newest-first from the query (so the LIMIT keeps the most recent), oldest-first for a chart.
    const points = rows
      .map((row) => ({ date: row.periodKey, windowedEventCount: row.eventCount }))
      .reverse()

    /*
     * Taken from the newest row rather than from `INTELLIGENCE_LOOKBACK_DAYS`. The rows were written
     * under whatever window was configured at capture time, and if that env var is ever tuned the
     * label has to describe the data rather than the current setting.
     */
    const lookbackDays = rows[0]?.lookbackDays ?? null

    return { points, lookbackDays }
  } catch {
    // Model not generated, or the read failed. An empty series is honest; the view says so.
    return { points: [], lookbackDays: null }
  }
}
