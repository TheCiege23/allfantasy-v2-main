/**
 * 🛑 THE YEAR-2 DERIVER HAD NO EVIDENCE TO READ FOR NBA AND NHL.
 *
 * `deriveDailySportSeasonStart.ts` names a later season's opener only from games a feed LABELS
 * regular season. Its two sources were the RI season-schedule cache (synced for MLB, NCAAB and soccer
 * only) and `SportsGame.seasonType` (NULL on every NBA/NHL row in production). So a 2027-28 NBA/NHL
 * dynasty league would never have derived an opener and held at NO_WEEK_SIGNAL for good.
 *
 * The third source is `player_game_stats`: the RI `/live` ingest stores each game's own
 * `season_type` (measured `"Regular Season"` on every game of fixtures/live.NBA.json and
 * live.NHL.json) in `normalizedStatMap.seasonType`. These tests pin that it is read, that only
 * `regular` counts, and that while nothing is labelled yet the roller says WHY it holds.
 *
 * No database: every client is a hand-built mock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearDerivedDailySportSeasonStarts,
  resolveDailySportSeasonStart,
  resolveDailySportWeekWindow,
} from '@/lib/season-week/dailySportSeasonStarts'
import {
  ensureDailySportSeasonStart,
  resetDailySportSeasonStartChecks,
} from '@/lib/season-week/deriveDailySportSeasonStart'

type StatRow = { sportType: string; gameDate: Date; seasonType: string | null }
const stat = (sportType: string, day: string, seasonType: string | null): StatRow => ({
  sportType,
  gameDate: new Date(`${day}T00:00:00.000Z`),
  seasonType,
})

/**
 * SportsGame holds only UNLABELLED rows (production NBA/NHL), and player_game_stats answers the
 * deriver's `findFirst` the way Postgres would: the JSON-path filter, the date range, oldest first.
 */
function dbWith(stats: StatRow[], opts: { withStats?: boolean } = {}) {
  const findFirst = vi.fn(async (args: any) => {
    const { sportType, gameDate, normalizedStatMap } = args.where
    expect(normalizedStatMap).toEqual({ path: ['seasonType'], equals: 'regular' })
    const hits = stats
      .filter((r) => r.sportType === sportType && r.seasonType === normalizedStatMap.equals)
      .filter((r) => r.gameDate >= gameDate.gte && r.gameDate < gameDate.lt)
      .sort((a, b) => a.gameDate.getTime() - b.gameDate.getTime())
    return hits[0] ? { gameDate: hits[0].gameDate } : null
  })
  const sportsGame = {
    findMany: vi.fn(async () => [
      { startTime: new Date('2027-10-05T23:00:00Z'), seasonType: null },
      { startTime: new Date('2027-10-26T23:30:00Z'), seasonType: null },
    ]),
  }
  const db = { sportsGame, ...(opts.withStats === false ? {} : { playerGameStat: { findFirst } }) }
  return { db: db as never, findFirst }
}

beforeEach(() => {
  clearDerivedDailySportSeasonStarts()
  resetDailySportSeasonStartChecks()
})
afterEach(() => vi.restoreAllMocks())

describe('player_game_stats labelled by the RI /live feed derive a year-2 opener', () => {
  it('NBA 2027: the earliest game stored as regular, past preseason and unlabelled rows', async () => {
    const { db, findFirst } = dbWith([
      stat('NBA', '2027-10-04', 'pre'), // preseason the feed labelled
      stat('NBA', '2027-10-09', null), // a label the classifier did not recognise — never regular
      stat('NBA', '2027-10-26', 'regular'), // opening night
      stat('NBA', '2027-10-27', 'regular'),
      stat('NHL', '2027-10-05', 'regular'), // another sport's opener must not leak in
    ])
    const res = await ensureDailySportSeasonStart('NBA', 2027, { db })
    expect(findFirst).toHaveBeenCalledTimes(1)
    expect(findFirst.mock.calls[0]![0]).toMatchObject({ where: { sportType: 'NBA' }, orderBy: { gameDate: 'asc' } })
    expect(res).toMatchObject({ source: 'schedule', estimated: false, opener: '2027-10-26T00:00:00.000Z' })
    expect(res.detail).toMatch(/Rolling Insights \/live game stats/)
    expect(resolveDailySportSeasonStart('NBA', 2027)).toBe('2027-10-26T00:00:00.000Z')
    expect(resolveDailySportWeekWindow('NBA', 2027, 1)?.start.toISOString()).toBe('2027-10-26T00:00:00.000Z')
  })

  it('NHL 2027 derives the same way — SportsGame alone (all NULL) could not', async () => {
    const { db } = dbWith([stat('NHL', '2027-09-21', 'pre'), stat('NHL', '2027-10-05', 'regular')])
    const res = await ensureDailySportSeasonStart('NHL', 2027, { db })
    expect(res.opener).toBe('2027-10-05T00:00:00.000Z')
    expect(res.source).toBe('schedule')
  })

  it('MLB 2028 too, and outside the ±21-day window a stat row is not evidence', async () => {
    const { db } = dbWith([stat('MLB', '2027-09-26', 'regular'), stat('MLB', '2028-03-23', 'regular')])
    const res = await ensureDailySportSeasonStart('MLB', 2028, { db })
    expect(res.opener).toBe('2028-03-23T00:00:00.000Z')
  })

  it('a client without playerGameStat (a narrower caller) still declines cleanly to the estimate', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { db } = dbWith([stat('NBA', '2027-10-26', 'regular')], { withStats: false })
    const res = await ensureDailySportSeasonStart('NBA', 2027, { db })
    expect(res).toMatchObject({ source: 'estimate', estimated: true })
    expect(resolveDailySportSeasonStart('NBA', 2027)).toBeNull()
  })
})

describe('before opening night is ingested, the hold is named, not generic', () => {
  it('resolveSportWeek reports SEASON_OPENER_UNRECORDED for an estimated-only season', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { resolveSportWeek } = await import('@/lib/season-week/seasonWeekService')
    const { db } = dbWith([stat('NBA', '2027-10-04', 'pre')])
    const resolved = await resolveSportWeek('NBA', 2027, { prisma: db, now: new Date('2027-10-10T12:00:00Z') })
    expect(resolved).toEqual({ ok: false, reason: 'SEASON_OPENER_UNRECORDED' })
    // The log names the one place a human records the published date.
    expect(String(warn.mock.calls[0]![0])).toMatch(/REGULAR_SEASON_START_UTC in lib\/season-week\/dailySportSeasonStarts\.ts/)
  })

})
