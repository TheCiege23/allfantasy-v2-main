/**
 * The game-day NFL stat refresh only works while a game is in play.
 *
 * NFL stat lines were imported once a day at 06:40 UTC, so a Sunday starter's box score — and the
 * matchup board's own points estimate for a league whose platform sends no player scores — appeared
 * on Monday morning. `?gameDay=1` runs every 15 minutes and must cost nothing outside a game window:
 * the gate below is what decides whether the provider is called at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sportsGameFindMany = vi.fn()
vi.mock('@/lib/prisma', () => ({ prisma: { sportsGame: { findMany: (...a: unknown[]) => sportsGameFindMany(...a) } } }))

import { findNflWeekInPlay, NFL_GAME_IN_PLAY_MS, nflWeekInPlay } from '@/lib/player-game-stats/nflWeekInPlay'

const game = (startTime: string, week = 11, seasonType: string | null = 'regular', season = 2026) =>
  ({ season, week, startTime: new Date(startTime), seasonType })

describe('nflWeekInPlay', () => {
  const sunday = [game('2026-11-22T18:00:00Z'), game('2026-11-22T21:25:00Z'), game('2026-11-23T01:20:00Z')]

  it('names the week from kickoff until five hours after it', () => {
    expect(nflWeekInPlay(sunday, new Date('2026-11-22T18:00:00Z'))).toEqual({ season: 2026, week: 11 })
    expect(nflWeekInPlay(sunday, new Date('2026-11-22T20:30:00Z'))).toEqual({ season: 2026, week: 11 })
    // The last game kicked off 01:20; it is in play until 06:20.
    expect(nflWeekInPlay(sunday, new Date('2026-11-23T06:20:00Z'))).toEqual({ season: 2026, week: 11 })
  })

  it('is null before the first kickoff, after the last window, and between game days', () => {
    expect(nflWeekInPlay(sunday, new Date('2026-11-22T17:59:00Z'))).toBeNull()
    expect(nflWeekInPlay(sunday, new Date('2026-11-23T06:21:00Z'))).toBeNull()
    expect(nflWeekInPlay([game('2026-11-20T01:15:00Z')], new Date('2026-11-21T15:00:00Z'))).toBeNull()
    expect(nflWeekInPlay([], new Date('2026-11-22T20:00:00Z'))).toBeNull()
  })

  it('ignores a preseason game, and a row missing its week, season or kickoff', () => {
    const now = new Date('2026-08-15T00:30:00Z')
    expect(nflWeekInPlay([game('2026-08-15T00:00:00Z', 1, 'pre')], now)).toBeNull()
    expect(nflWeekInPlay([game('2026-08-15T00:00:00Z', 1, null)], now)).toBeNull()
    expect(nflWeekInPlay([
      { season: 2026, week: null, startTime: new Date('2026-08-15T00:00:00Z'), seasonType: 'regular' },
      { season: null, week: 1, startTime: new Date('2026-08-15T00:00:00Z'), seasonType: 'regular' },
      { season: 2026, week: 1, startTime: null, seasonType: 'regular' },
    ], now)).toBeNull()
  })

  it('takes the later week when two have a game in play', () => {
    const now = new Date('2026-11-24T02:00:00Z')
    expect(nflWeekInPlay([game('2026-11-24T01:15:00Z', 11), game('2026-11-24T01:30:00Z', 12)], now)).toEqual({ season: 2026, week: 12 })
  })
})

describe('findNflWeekInPlay', () => {
  beforeEach(() => vi.clearAllMocks())
  const now = new Date('2026-11-22T20:30:00Z')

  it('reads only NFL games that kicked off in the last five hours', async () => {
    sportsGameFindMany.mockResolvedValue([game('2026-11-22T18:00:00Z')])
    expect(await findNflWeekInPlay({ now })).toEqual({ season: 2026, week: 11 })
    const where = sportsGameFindMany.mock.calls[0][0].where
    expect(where.sport).toBe('NFL')
    expect(where.startTime).toEqual({ gte: new Date(now.getTime() - NFL_GAME_IN_PLAY_MS), lte: now })
  })

  it('answers null when the schedule read fails, so the refresh does nothing', async () => {
    sportsGameFindMany.mockRejectedValue(new Error('connection lost'))
    expect(await findNflWeekInPlay({ now })).toBeNull()
  })
})
