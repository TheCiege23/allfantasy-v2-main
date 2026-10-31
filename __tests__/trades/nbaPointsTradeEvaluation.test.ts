import { beforeEach, describe, expect, it, vi } from 'vitest'

const { identities, seasons, games } = vi.hoisted(() => ({
  identities: vi.fn(), seasons: vi.fn(), games: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  playerIdentityMap: { findMany: identities },
  playerSeasonStats: { findMany: seasons },
  playerGameStat: { findMany: games },
} }))

import { loadNbaPointsTradeEvaluation, priceNbaHistory, readNbaPlayerHistory, scoreNbaStats } from '@/lib/trades/nbaPointsTradeEvaluation'
import type { TradeLeagueContext } from '@/lib/trades/loadTradeLeagueContext'
import { fantraxScoringRules } from '@/lib/league-import/fantrax/fantraxScoring'
import type { FantraxLeagueInfo } from '@/lib/league-import/fantrax/fantraxApi'
import nbaFantraxFixture from '../fixtures/fantrax-nba-points-scoring.json'

const league = {
  scoringRules: { points_scored: 1, rebound: 1.2, assist: 1.5, turnover: -1 },
} as TradeLeagueContext

const history = (playerId: string, points: number, priorPoints: number) => ({
  playerId, sport: 'NBA',
  seasons: [
    { season: '2025-2026', gamesPlayed: 10, stats: { points, total_rebounds: 50, assists: 40, turnovers: 20 }, source: 'rolling_insights' },
    { season: '2024-2025', gamesPlayed: 10, stats: { points: priorPoints, total_rebounds: 40, assists: 30, turnovers: 15 }, source: 'rolling_insights' },
  ],
  gameLogs: [],
})

describe('NBA points trade evaluation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    games.mockResolvedValue([])
  })

  it('applies saved NBA weights to provider aliases and preserves zero-weight rules', () => {
    expect(scoreNbaStats({ points: 20, total_rebounds: 10, assists: 5, turnovers: 3 }, league.scoringRules))
      .toBe(36.5)
    expect(scoreNbaStats({ points: 20 }, { points: 0 })).toBeNull()
  })

  it('compares two teams with every weight from the captured Fantrax NBA league', async () => {
    const mapped = fantraxScoringRules(nbaFantraxFixture as unknown as FantraxLeagueInfo, 'nba')
    expect(mapped.gaps).toEqual([])
    const fantraxLeague = {
      ...league,
      scoringRules: Object.fromEntries(mapped.rules.map((rule) => [rule.stat_key, rule.points_value])),
    } as TradeLeagueContext
    identities.mockImplementation(async ({ where }: any) => {
      const name = where.OR[0].canonicalName.equals
      return [{ id: name, canonicalName: name, sleeperId: null, rollingInsightsId: null,
        espnId: null, fantraxId: null }]
    })
    seasons.mockImplementation(async ({ where }: any) => {
      const factor = where.playerId.in[0] === 'Player A' ? 1 : 0.5
      return [{ season: '2025-2026', gamesPlayed: 10, fetchedAt: new Date('2026-04-01'),
        source: 'rolling_insights', stats: { points: 200 * factor, total_rebounds: 100 * factor,
          assists: 50 * factor, steals: 20 * factor, blocks: 10 * factor, turnovers: 30 * factor } }]
    })
    const result = await loadNbaPointsTradeEvaluation({
      league: fantraxLeague,
      senderGives: [{ name: 'Player A' }], receiverGives: [{ name: 'Player B' }],
    })
    expect(result).toMatchObject({ ok: true, senderTotal: 43, receiverTotal: 21.5 })
  })

  it('blends current and previous measured season rates and reports recent data separately', () => {
    const priced = priceNbaHistory('Player A', history('player-a', 200, 100) as any, league.scoringRules)
    expect(priced).toMatchObject({
      playerId: 'player-a', currentSeason: '2025-2026', seasonGames: 10,
      currentPointsPerGame: 30, previousPointsPerGame: 17.8,
      pointsPerGame: 26.34, recentFivePointsPerGame: null,
    })
  })

  it('will not infer season bonus counts from season totals', () => {
    expect(priceNbaHistory('Player A', history('player-a', 200, 100) as any, {
      ...league.scoringRules, double_double: 2,
    })).toBeNull()
  })

  it('scores per-game double-double bonuses when every season game is present', () => {
    const fullHistory = {
      playerId: 'player-a', seasons: [{ season: '2025-2026', gamesPlayed: 2,
        stats: { points: 21 }, source: 'rolling_insights' }],
      gameLogs: [
        { season: 2026, date: '2026-01-02', stats: { pts: 12, reb: 11 } },
        { season: 2026, date: '2026-01-01', stats: { pts: 9, reb: 2 } },
      ],
    }
    expect(priceNbaHistory('Player A', fullHistory as any, { points: 1, double_double: 2 }))
      .toMatchObject({ currentPointsPerGame: 11.5, pointsPerGame: 11.5 })
  })

  it('does not silently use an older season when the latest one cannot be scored', () => {
    const incomplete = history('player-a', 200, 100)
    incomplete.seasons[0].stats = { points: 200 }
    expect(priceNbaHistory('Player A', incomplete as any, { points: 1, double_double: 2 })).toBeNull()
  })

  it('compares both sides without turning the recent-data gap into zero value', async () => {
    identities.mockImplementation(async ({ where }: any) => {
      const name = where.OR[0].canonicalName.equals
      const id = name === 'Player A' ? 'player-a' : 'player-b'
      return [{ id, canonicalName: name, sleeperId: null, rollingInsightsId: null, espnId: null, fantraxId: null }]
    })
    seasons.mockImplementation(async ({ where }: any) =>
      history(where.playerId.in[0], where.playerId.in[0] === 'player-a' ? 200 : 100, 100).seasons
        .map((row) => ({ ...row, fetchedAt: new Date('2026-04-01') })))
    const result = await loadNbaPointsTradeEvaluation({
      league, senderGives: [{ name: 'Player A' }], receiverGives: [{ name: 'Player B' }],
    })
    expect(result).toMatchObject({
      ok: true, senderTotal: 26.34, receiverTotal: 19.34,
      coverage: ['Player A: recent game sample unavailable', 'Player B: recent game sample unavailable'],
    })
  })

  it('refuses an unpriced player instead of assigning zero', async () => {
    identities.mockImplementation(async ({ where }: any) => [{
      id: where.OR[0].canonicalName.equals, canonicalName: where.OR[0].canonicalName.equals,
      sleeperId: null, rollingInsightsId: null, espnId: null, fantraxId: null,
    }])
    seasons.mockResolvedValue([])
    await expect(loadNbaPointsTradeEvaluation({
      league, senderGives: [{ name: 'Player A' }], receiverGives: [{ name: 'Player B' }],
    })).resolves.toMatchObject({ ok: false, code: 'PLAYER_STATS_UNAVAILABLE', players: ['Player A', 'Player B'] })
  })

  it('resolves Fantrax player IDs through the tracked identity map', async () => {
    identities.mockResolvedValue([{ id: 'identity-a', canonicalName: 'Player A', sleeperId: null,
      rollingInsightsId: 'ri-a', espnId: null, fantraxId: 'fantrax-a' }])
    seasons.mockResolvedValue(history('identity-a', 200, 100).seasons
      .map((row) => ({ ...row, fetchedAt: new Date('2026-04-01') })))
    const result = await readNbaPlayerHistory({ name: 'Player A', playerId: 'fantrax-a' })
    expect(result.playerId).toBe('identity-a')
    expect(identities).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sport: 'NBA', OR: expect.arrayContaining([{ fantraxId: 'fantrax-a' }]) }),
    }))
    expect(seasons).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ playerId: { in: ['identity-a', 'ri-a', 'fantrax-a'] } }),
    }))
  })
})
