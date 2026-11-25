import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The college basketball player card said "Game logs for NCAAB coming soon" while every game was
 * stored (production, 2026-11-25). These pin the counting rules of the season line and game log the
 * card now shows.
 */

const db = vi.hoisted(() => ({ $queryRaw: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { isRollingInsightsPlayerId, loadNcaabPlayerSeasons, summarizeNcaabGames, type NcaabGameRow } from '@/lib/players/ncaabPlayerSeasons'

const now = new Date('2026-11-25T18:00:00Z')
const box = (over: Record<string, unknown> = {}) => ({
  minutes: 30, points: 20, total_rebounds: 6, assists: 4, steals: 2, blocks: 1, turnovers: 3,
  three_points_made: 2, three_points_attempted: 5, field_goals_made: 7, field_goals_attempted: 14,
  free_throws_made: 4, free_throws_attempted: 5, ...over,
})
const row = (over: Partial<NcaabGameRow> = {}): NcaabGameRow => ({
  season: 2026, gameDate: '2026-11-20', team: 'UCF', opponent: 'VAN', seasonType: 'regular', gameFinal: null, box: box(), ...over,
})

describe('summarizeNcaabGames', () => {
  it('averages a season per game and keeps the game log newest first', () => {
    const out = summarizeNcaabGames([
      row({ gameDate: '2026-11-10', opponent: 'USA', box: box({ points: 10, total_rebounds: 2, minutes: 20 }) }),
      row({ gameDate: new Date('2026-11-20T00:00:00Z'), opponent: 'VAN', box: box({ points: 30, total_rebounds: 7, minutes: 36 }) }),
    ], now)

    expect(out.games.map((g) => [g.date, g.opponent, g.points])).toEqual([['2026-11-20', 'VAN', 30], ['2026-11-10', 'USA', 10]])
    expect(out.seasons).toHaveLength(1)
    expect(out.seasons[0]).toMatchObject({
      season: 2026, label: '2026–27', games: 2, postseasonGames: 0, team: 'UCF',
      perGame: { points: 20, rebounds: 4.5, minutes: 28, assists: 4, steals: 2, blocks: 1, turnovers: 3, threesMade: 2 },
    })
    expect(out.seasons[0]!.fieldGoalPct).toBeCloseTo(14 / 28)
    expect(out.seasons[0]!.threePointPct).toBeCloseTo(4 / 10)
    expect(out.seasons[0]!.freeThrowPct).toBeCloseTo(8 / 10)
  })

  it('counts postseason games in the season and says how many, but never the preseason', () => {
    const out = summarizeNcaabGames([
      row({ season: 2025, gameDate: '2026-03-20', seasonType: 'post', opponent: 'DUKE' }),
      row({ season: 2025, gameDate: '2026-01-10', seasonType: 'regular' }),
      row({ season: 2025, gameDate: '2025-10-28', seasonType: 'pre', box: box({ points: 99 }) }),
    ], now)

    expect(out.seasons[0]).toMatchObject({ season: 2025, label: '2025–26', games: 2, postseasonGames: 1 })
    expect(out.seasons[0]!.perGame.points).toBe(20)
    expect(out.games.map((g) => g.postseason)).toEqual([true, false])
  })

  it('counts only finished games he played in', () => {
    const out = summarizeNcaabGames([
      row({ gameDate: '2026-11-25', gameFinal: null, opponent: 'LIVE', box: box({ points: 50 }) }), // today, still going
      row({ gameDate: '2026-11-25', gameFinal: 'true', opponent: 'DONE', box: box({ points: 40 }) }), // today, final
      row({ gameDate: '2026-11-20', opponent: 'DNP', box: Object.fromEntries(Object.keys(box()).map((k) => [k, 0])) }), // did not play
      row({ gameDate: '2026-11-18', opponent: 'BAD', box: null }),
      row({ gameDate: '2026-11-15', opponent: 'OK', box: box({ points: 10 }) }),
    ], now)

    expect(out.games.map((g) => g.opponent)).toEqual(['DONE', 'OK'])
    expect(out.seasons[0]).toMatchObject({ games: 2, perGame: { points: 25 } })
  })

  it('counts a game the vendor recorded no minutes for, and averages minutes over the games that have them', () => {
    // 4.3% of the 2025-26 lines carry points and shots with minutes 0 (production, 2026-11-25).
    const out = summarizeNcaabGames([
      row({ gameDate: '2026-11-20', opponent: 'TIMED', box: box({ minutes: 30, points: 20 }) }),
      row({ gameDate: '2026-11-10', opponent: 'UNTIMED', box: box({ minutes: 0, points: 10 }) }),
    ], now)

    expect(out.games.map((g) => [g.opponent, g.minutes, g.points])).toEqual([['TIMED', 30, 20], ['UNTIMED', 0, 10]])
    // Both games count toward points; the untimed one does not drag minutes down to 15.
    expect(out.seasons[0]).toMatchObject({ games: 2, perGame: { points: 15, minutes: 30 } })
  })

  it('has no minutes average when no game recorded any', () => {
    const out = summarizeNcaabGames([row({ box: box({ minutes: 0 }) })], now)
    expect(out.seasons[0]).toMatchObject({ games: 1, perGame: { minutes: null, points: 20 } })
  })

  it('returns seasons newest first, each with its own latest team', () => {
    const out = summarizeNcaabGames([
      row({ season: 2025, gameDate: '2026-02-01', team: 'BEL' }),
      row({ season: 2026, gameDate: '2026-11-20', team: 'DUKE' }),
      row({ season: 2026, gameDate: '2026-11-05', team: 'DUKE' }),
    ], now)

    expect(out.seasons.map((s) => [s.season, s.team, s.games])).toEqual([[2026, 'DUKE', 2], [2025, 'BEL', 1]])
  })

  it('leaves a percentage empty with no attempts, and treats junk numbers as zero', () => {
    const out = summarizeNcaabGames([
      row({ box: box({ free_throws_made: 0, free_throws_attempted: 0, assists: 'x', steals: -3, blocks: Number.NaN }) }),
    ], now)

    expect(out.seasons[0]!.freeThrowPct).toBeNull()
    expect(out.seasons[0]!.perGame).toMatchObject({ assists: 0, steals: 0, blocks: 0 })
  })

  it('is empty for no rows', () => {
    expect(summarizeNcaabGames([], now)).toEqual({ seasons: [], games: [] })
  })
})

describe('loadNcaabPlayerSeasons', () => {
  beforeEach(() => db.$queryRaw.mockReset())

  it('reads by Rolling Insights id and summarizes what comes back', async () => {
    db.$queryRaw.mockResolvedValue([row()])

    const out = await loadNcaabPlayerSeasons(' 11119 ', now)

    expect(out.seasons[0]).toMatchObject({ season: 2026, games: 1 })
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)
    // The id travels as a bound parameter, never spliced into the SQL text.
    const sql = db.$queryRaw.mock.calls[0]![0] as { strings: string[]; values: unknown[] }
    expect(sql.values).toContain('11119')
    expect(sql.strings.join('')).not.toContain('11119')
  })

  it('never queries for an id that is not a Rolling Insights id', async () => {
    for (const id of ['', 'espn:ncaab:5241333', 'name:A.C. Kelly:G:USA', "1' OR '1'='1", '501140d5-a9dd-40ff-bd02-cfceda9a4a06']) {
      expect(await loadNcaabPlayerSeasons(id, now)).toEqual({ seasons: [], games: [] })
    }
    expect(db.$queryRaw).not.toHaveBeenCalled()
  })

  it('recognises a Rolling Insights id', () => {
    expect(isRollingInsightsPlayerId('4951')).toBe(true)
    expect(isRollingInsightsPlayerId(' 4951 ')).toBe(true)
    expect(isRollingInsightsPlayerId('49 51')).toBe(false)
    expect(isRollingInsightsPlayerId(null)).toBe(false)
  })
})
