import { beforeEach, describe, expect, it, vi } from 'vitest'

const getLatestNewsMock = vi.fn()
const getInjuryReportMock = vi.fn()
const sportsGameFindManyMock = vi.fn()
const sportsDataCacheFindManyMock = vi.fn()
const sportsNewsFindManyMock = vi.fn()
const sportsInjuryFindManyMock = vi.fn()
const playerSeasonStatsFindManyMock = vi.fn()
const weatherCacheFindManyMock = vi.fn()
const fantasyStatLineFindManyMock = vi.fn()
const fetchNewsAPIEverythingMock = vi.fn()

vi.mock('@/lib/data/news', () => ({
  getLatestNews: getLatestNewsMock,
}))

vi.mock('@/lib/data/players', () => ({
  getInjuryReport: getInjuryReportMock,
}))

vi.mock('@/app/api/sports/news/sync-helper', () => ({
  fetchNewsAPIEverything: fetchNewsAPIEverythingMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsGame: { findMany: sportsGameFindManyMock },
    sportsDataCache: { findMany: sportsDataCacheFindManyMock },
    sportsNews: { findMany: sportsNewsFindManyMock },
    sportsInjury: { findMany: sportsInjuryFindManyMock },
    playerSeasonStats: { findMany: playerSeasonStatsFindManyMock },
    /*
     * ⚠ THE MODULE READS SIX DELEGATES; THIS FACTORY LISTED FOUR OF THEM.
     * `buildChimmySportDataDigest` grew calls to prisma.weatherCache (the games branch)
     * and prisma.fantasyStatLine (the player-line branch), and this mock was never
     * extended — so the games path died on `undefined.findMany` rather than on anything
     * it does. Same rot as any stale vi.mock: the module moved, the double did not.
     * If a seventh delegate appears, it belongs here too.
     */
    weatherCache: { findMany: weatherCacheFindManyMock },
    fantasyStatLine: { findMany: fantasyStatLineFindManyMock },
  },
}))

describe('buildChimmySportDataDigest seeded fixture scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getLatestNewsMock.mockResolvedValue([])
    getInjuryReportMock.mockResolvedValue([])
    sportsGameFindManyMock.mockResolvedValue([])
    sportsDataCacheFindManyMock.mockResolvedValue([])
    sportsNewsFindManyMock.mockResolvedValue([])
    sportsInjuryFindManyMock.mockResolvedValue([])
    playerSeasonStatsFindManyMock.mockResolvedValue([])
    weatherCacheFindManyMock.mockResolvedValue([])
    fantasyStatLineFindManyMock.mockResolvedValue([])
    fetchNewsAPIEverythingMock.mockResolvedValue([])
  })

  it('builds NFL draft date context from seeded DB-backed news rows', async () => {
    getLatestNewsMock.mockResolvedValueOnce([
      {
        id: 'nfl-news-1',
        headline: 'NFL Draft starts April 30, 2026 in Detroit.',
        playerName: null,
        team: null,
        source: 'api_sports',
        publishedAt: new Date('2026-04-25T12:00:00.000Z'),
      },
    ])

    const { buildChimmySportDataDigest } = await import('@/lib/chimmy/chimmy-sport-data-digest')
    const digest = await buildChimmySportDataDigest({
      sport: 'NFL',
      question: 'When is the NFL Draft?',
      includeNewsApi: false,
      timezone: 'America/New_York',
    })

    expect(digest.text).toContain('NFL Draft starts April 30, 2026 in Detroit.')
    expect(digest.sources).toContain('player_news_NFL')
    expect(digest.freshness.perSource.player_news_NFL).toBe('2026-04-25T12:00:00.000Z')
    expect(digest.freshness.overallLastSyncedAt).toBe('2026-04-25T12:00:00.000Z')
  })

  it('bridges cached MLB SportsNews rows into Chimmy context when player-news rows are absent', async () => {
    sportsNewsFindManyMock.mockImplementation(async ({ where }: { where?: { sport?: string } }) => {
      if (where?.sport !== 'MLB') return []
      return [
        {
          title: 'Yankees game notes list two home runs from verified game recap.',
          playerName: null,
          team: 'NYY',
          source: 'newsapi',
          publishedAt: new Date('2026-06-04T13:00:00.000Z'),
          fetchedAt: new Date('2026-06-04T13:05:00.000Z'),
          updatedAt: new Date('2026-06-04T13:05:00.000Z'),
        },
      ]
    })

    const { buildChimmySportDataDigest } = await import('@/lib/chimmy/chimmy-sport-data-digest')
    const digest = await buildChimmySportDataDigest({
      sport: 'MLB',
      question: 'What MLB news is available?',
      includeNewsApi: false,
      timezone: 'America/New_York',
    })

    expect(digest.text).toContain('MLB - Sports news (DB cache)')
    expect(digest.text).toContain('Yankees game notes')
    expect(digest.sources).toContain('sports_news_MLB')
    expect(digest.freshness.perSource.sports_news_MLB).toBe('2026-06-04T13:00:00.000Z')
  })

  /*
   * ⚠ THIS TEST USED TO ASSERT THE BUG, AND IT IS INVERTED HERE ON PURPOSE.
   *
   * It required the digest to surface a cached SportsInjury row — the fixture below is dated
   * 2026-06-04 — under the heading "NBA - Injuries (DB cache)". That is exactly the behaviour
   * 3c784afe5 removed, and the reason it removed it is measured, not stylistic: in production
   * the newest injury_report_records row was 108 days old, and Chimmy rendered those rows with
   * no date attached, so the model stated April designations as today's news.
   *
   * Both Chimmy paths now read lib/injuries/injuryReadPort, which is TTL-respecting. The stale
   * fixture still reaches it through the mocked prisma — so this test now proves the port SEES
   * the row and REFUSES it, which is a stronger guarantee than the old assertion ever made.
   *
   * 🛑 DO NOT "FIX" THIS BY MAKING THE DIGEST EMIT THE ROW AGAIN. A green
   * `toContain('Example Guard')` here would mean a three-month-old injury designation is being
   * served as current, which is the incident #404 describes.
   */
  it('refuses a stale cached SportsInjury row rather than serving it as current', async () => {
    sportsInjuryFindManyMock.mockImplementation(async ({ where }: { where?: { sport?: string } }) => {
      if (where?.sport !== 'NBA') return []
      return [
        {
          playerName: 'Example Guard',
          team: 'NYK',
          status: 'Questionable',
          description: 'Ankle soreness',
          date: new Date('2026-06-04T10:00:00.000Z'),
          fetchedAt: new Date('2026-06-04T10:05:00.000Z'),
          updatedAt: new Date('2026-06-04T10:05:00.000Z'),
        },
      ]
    })

    const { buildChimmySportDataDigest } = await import('@/lib/chimmy/chimmy-sport-data-digest')
    const digest = await buildChimmySportDataDigest({
      sport: 'NBA',
      question: 'Any NBA injury updates?',
      includeNewsApi: false,
      timezone: 'America/New_York',
    })

    // The stale player must NOT appear, under any heading.
    expect(digest.text).not.toContain('Example Guard')
    expect(digest.text).not.toContain('Injuries (DB cache)')

    // And the digest must say so explicitly, rather than going quiet — a silent omission would
    // let the model fill the gap from its own priors, which is the same failure by another route.
    expect(digest.text).toContain('every row in the feed is past its freshness window')
    expect(digest.text).toContain("Do not state or imply any player's injury status for NBA")

    // The stale timestamp must never be published as this source's freshness.
    expect(digest.freshness.perSource.sports_injuries_NBA).not.toBe('2026-06-04T10:00:00.000Z')
  })

  it('builds NBA tonight games context from seeded sportsGame fixtures', async () => {
    sportsGameFindManyMock.mockImplementation(async ({ where }: { where?: { sport?: string } }) => {
      if (where?.sport !== 'NBA') return []
      return [
        {
          awayTeam: 'Lakers',
          homeTeam: 'Celtics',
          awayScore: 0,
          homeScore: 0,
          status: 'Scheduled',
          startTime: new Date('2026-04-25T23:30:00.000Z'),
          updatedAt: new Date('2026-04-25T20:00:00.000Z'),
        },
      ]
    })

    const { buildChimmySportDataDigest } = await import('@/lib/chimmy/chimmy-sport-data-digest')
    const digest = await buildChimmySportDataDigest({
      sport: 'NBA',
      question: 'What NBA games are tonight?',
      includeNewsApi: false,
      timezone: 'America/New_York',
    })

    expect(digest.text).toContain('NBA — Upcoming/recent games (DB)')
    expect(digest.text).toContain('Lakers @ Celtics')
    expect(digest.sources).toContain('games_NBA')
    expect(digest.freshness.perSource.games_NBA).toBe('2026-04-25T20:00:00.000Z')
    expect(digest.freshness.overallLastSyncedAt).toBe('2026-04-25T20:00:00.000Z')
  })

  it('builds playoff series/record context from seeded standings cache fixtures', async () => {
    sportsDataCacheFindManyMock.mockResolvedValueOnce([
      {
        cacheKey: 'NBA:standings:east',
        data: {
          teamName: 'Boston Celtics',
          position: 1,
          won: 58,
          lost: 24,
        },
        updatedAt: new Date('2026-04-25T18:30:00.000Z'),
      },
      {
        cacheKey: 'NBA:standings:east',
        data: {
          teamName: 'New York Knicks',
          position: 2,
          won: 54,
          lost: 28,
        },
        updatedAt: new Date('2026-04-25T18:30:00.000Z'),
      },
    ])

    const { buildChimmySportDataDigest } = await import('@/lib/chimmy/chimmy-sport-data-digest')
    const digest = await buildChimmySportDataDigest({
      sport: 'NBA',
      question: 'What is the playoff series record for Knicks vs Celtics?',
      includeNewsApi: false,
      timezone: 'America/New_York',
    })

    expect(digest.text).toContain('NBA — Standings snapshot (DB)')
    expect(digest.text).toContain('Boston Celtics')
    expect(digest.text).toContain('New York Knicks')
    expect(digest.sources).toContain('standings_NBA')
    expect(digest.freshness.perSource.standings_NBA).toBe('2026-04-25T18:30:00.000Z')
    expect(digest.freshness.overallLastSyncedAt).toBe('2026-04-25T18:30:00.000Z')
  })
})
