import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/category-scoring/leagueScoringType', () => ({ readScoringType: () => ({ mode: 'points' }) }))
vi.mock('@/lib/redraft/scoringEngine', () => ({ buildLeagueStatScorer: ({ sport }: { sport: string }) =>
  (stats: Record<string, number>) => sport === 'NCAAF' ? (stats.pass_yds ?? 0) * 0.04
    : sport === 'NCAAB' ? (stats.pts ?? 0) + (stats.reb ?? 0) * 1.2
      : (stats.goals ?? 0) * 6 + (stats.clean_sheet_def ?? 0) * 4 }))
vi.mock('@/lib/redraft/leagueScoringRules', () => ({ resolveLeagueScoringRules: ({ sport }: { sport: string }) => ({
  categories: (sport === 'NCAAF' ? ['pass_yds'] : sport === 'NCAAB' ? ['pts', 'reb'] : ['goals', 'clean_sheet_def'])
    .map((key) => ({ key, defaultPoints: 1 })), overrides: {},
}) }))
vi.mock('@/lib/redraft/lineupLock', () => ({
  buildWeekKickoffMap: vi.fn(async () => ({ byTeam: new Map([['school:miami', new Date('2026-11-05T20:00:00Z')]]) })),
  lockTeamLookupKeys: (sport: string) => sport === 'NCAAF' ? ['school:miami'] : ['Miami'],
  normalizeLockTeam: (_sport: string, team: string) => team,
}))
vi.mock('@/lib/season-week/dailySportSeasonStarts', () => ({
  dailySportWeekForInstant: () => 10,
  resolveDailySportWeekWindow: () => ({ start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-11-08T00:00:00Z') }),
}))
vi.mock('@/lib/sports-data/riScheduleCache', () => ({ readRiScheduleWindow: vi.fn() }))

import { readRiScheduleWindow } from '@/lib/sports-data/riScheduleCache'
import { loadFinderCollegeSoccerOutlook } from '@/lib/projections/finderCollegeSoccerOutlook'

const player = { key: 'roster:123', lookupId: 'identity-1', team: 'Miami', position: 'QB', injuryStatus: null }
const lines = [100, 200, 300].map((yards, index) => ({
  playerId: 'cfbd-123', gameId: `game-${index}`, normalizedStatMap: { 'passing.YDS': yards }, gameDate: new Date(`2026-10-${10 + index}T00:00:00Z`),
}))

describe('Finder college and soccer outlook gates', () => {
  beforeEach(() => vi.mocked(readRiScheduleWindow).mockReset())

  it('prices only a verified NCAAF athlete with three league-scored games and a future CFBD fixture', async () => {
    const db = {
      sportsGame: { findFirst: vi.fn(async () => ({ week: 10 })) },
      playerIdentityMap: { findMany: vi.fn(async () => [{ id: 'identity-1', cfbdId: 'cfbd-123' }]) },
      playerGameStat: { findMany: vi.fn(async () => lines) },
    }
    const result = await loadFinderCollegeSoccerOutlook(db as never, {
      league: { sport: 'NCAAF', season: 2026, settings: {} }, players: [player], now: new Date('2026-11-03T12:00:00Z'),
    })
    expect(result.byKey.get(player.key)).toMatchObject({ projectedPoints: 8, periodGames: 1, recentGames: 3 })
    expect(result.period).toMatchObject({ kind: 'week', season: 2026, week: 10 })
  })

  it('refuses NCAAB advice when the verified season schedule is not synced', async () => {
    vi.mocked(readRiScheduleWindow).mockResolvedValue(null)
    const result = await loadFinderCollegeSoccerOutlook({} as never, {
      league: { sport: 'NCAAB', season: 2026, settings: {} }, players: [player], now: new Date('2026-11-03T12:00:00Z'),
    })
    expect(result.reason).toBe('schedule_not_synced')
    expect(result.byKey.size).toBe(0)
  })

  it('scores measured nested NCAAB box stats against a verified weekly slate', async () => {
    vi.mocked(readRiScheduleWindow).mockResolvedValue([{
      gameId: 'basketball-1', homeTeam: 'Miami', awayTeam: 'Duke',
      startTime: '2026-11-05T20:00:00Z', status: 'scheduled',
    }] as never)
    const db = {
      playerIdentityMap: { findMany: vi.fn(async () => [{ id: 'identity-1', cfbdId: null }]) },
      playerGameStat: { findMany: vi.fn(async () => [10, 20, 30].map((points, index) => ({
        playerId: 'identity-1', gameId: `game-${index}`, gameDate: new Date('2026-10-20T00:00:00Z'),
        normalizedStatMap: { stats: { points, total_rebounds: 5 } },
      }))) },
    }
    const result = await loadFinderCollegeSoccerOutlook(db as never, {
      league: { sport: 'NCAAB', season: 2026, settings: {} }, players: [player], now: new Date('2026-11-03T12:00:00Z'),
    })
    expect(result.byKey.get(player.key)).toMatchObject({ projectedPoints: 26, periodGames: 1, recentGames: 3 })
  })

  it('refuses a CFBD game log claimed by two identity rows', async () => {
    const db = {
      sportsGame: { findFirst: vi.fn(async () => ({ week: 10 })) },
      playerIdentityMap: { findMany: vi.fn()
        .mockResolvedValueOnce([{ id: 'identity-1', cfbdId: 'cfbd-123' }])
        .mockResolvedValueOnce([{ id: 'identity-1', cfbdId: 'cfbd-123' }, { id: 'other', cfbdId: 'cfbd-123' }]) },
    }
    const result = await loadFinderCollegeSoccerOutlook(db as never, {
      league: { sport: 'NCAAF', season: 2026, settings: {} }, players: [player], now: new Date('2026-11-03T12:00:00Z'),
    })
    expect(result.reason).toBe('no_game_log_bridge')
    expect(result.byKey.size).toBe(0)
  })

  it('refuses soccer advice without a league competition even when fixtures exist', async () => {
    vi.mocked(readRiScheduleWindow).mockResolvedValue([{ gameId: 'fixture-1', competition: 'EPL' }] as never)
    const result = await loadFinderCollegeSoccerOutlook({} as never, {
      league: { sport: 'SOCCER', season: 2026, settings: {} }, players: [player], now: new Date('2026-11-03T12:00:00Z'),
    })
    expect(result.reason).toBe('competition_not_verified')
    expect(result.byKey.size).toBe(0)
  })

  it('scores only measured soccer fields and the verified competition', async () => {
    vi.mocked(readRiScheduleWindow).mockResolvedValue([
      { gameId: 'epl-1', competition: 'EPL', homeTeamId: 'Miami', awayTeamId: 'Duke', startTime: '2026-11-05T20:00:00Z', status: 'scheduled' },
      { gameId: 'liga-1', competition: 'LALIGA', homeTeamId: 'Miami', awayTeamId: 'Madrid', startTime: '2026-11-05T20:00:00Z', status: 'scheduled' },
    ] as never)
    const db = {
      playerIdentityMap: { findMany: vi.fn(async () => [{ id: 'identity-1', cfbdId: null }]) },
      playerGameStat: { findMany: vi.fn(async () => [0, 1, 0].map((goals, index) => ({
        playerId: 'identity-1', gameId: `game-${index}`, gameDate: new Date('2026-10-20T00:00:00Z'),
        normalizedStatMap: { stats: { goals, clean_sheets: 1, yellow_cards: 0 } },
      }))) },
    }
    const result = await loadFinderCollegeSoccerOutlook(db as never, {
      league: { sport: 'SOCCER', season: 2026, settings: { soccerCompetition: 'EPL' } },
      players: [{ ...player, position: 'DEF' }], now: new Date('2026-11-03T12:00:00Z'),
    })
    expect(result.byKey.get(player.key)).toMatchObject({ projectedPoints: 6, periodGames: 1, recentGames: 3 })
  })
})
