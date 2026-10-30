/**
 * lib/core-app/bestBallField.ts — a best-ball elimination league's field, valued on projected finals: banked
 * points plus the best lineup the remaining players can still make. Owner's report 2026-10-30: in best ball the
 * live score is only a floor until the last game is final, so a points rank put Sunday-night teams in the cut.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ projections: vi.fn(), players: vi.fn(), scores: vi.fn(), games: vi.fn(), availability: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    fantasyProjection: { findMany: h.projections },
    sportsPlayer: { findMany: h.players },
    leaguePlayerWeeklyScore: { findMany: h.scores },
    sportsGame: { findMany: h.games },
  },
}))
vi.mock('@/lib/core-app/rosterIdCrosswalk', () => ({
  crosswalkToSleeperIds: async () => new Map(),
  sleeperLookupId: (_p: string, id: string) => id,
}))
vi.mock('@/lib/core-app/matchupProjections', () => ({ readPlayerAvailability: h.availability }))
// Each projection row's stat line carries its own points; the league's rules are not what is under test.
vi.mock('@/lib/projections/leagueScoring', () => ({
  extractScoringSettings: () => ({ rec: 1 }),
  hasScoringRules: () => true,
  computeLeagueProjectedPoints: (stats: Record<string, unknown> | null) => (stats ? { points: Number(stats.pts) } : null),
}))
vi.mock('@/lib/core-app/playerIdentityCompose', () => ({
  composePlayerIdentities: (rows: Array<{ sleeperId: string; position: string; team: string }>) =>
    new Map(rows.map((r) => [r.sleeperId, { position: r.position, team: r.team }])),
}))

import { loadBestBallField } from '@/lib/core-app/bestBallField'

const NOW = new Date()
const league = { platform: 'sleeper', sport: 'NFL', settings: { roster_positions: ['QB', 'WR', 'BN', 'BN'] } }
// A: QB played (final, 20), WR1 played (final, 8), WR2 plays Sunday night (projected 18).
// B: QB played (final, 25), WR3 played (final, 15), WR4 on bye.
const players = [
  { sleeperId: 'qa', position: 'QB', team: 'KC' },
  { sleeperId: 'w1', position: 'WR', team: 'KC' },
  { sleeperId: 'w2', position: 'WR', team: 'NYG' },
  { sleeperId: 'qb', position: 'QB', team: 'BUF' },
  { sleeperId: 'w3', position: 'WR', team: 'BUF' },
  { sleeperId: 'w4', position: 'WR', team: 'SEA' },
]
const games = (nightStatus: string) => [
  { homeTeam: 'KC', awayTeam: 'BUF', status: 'final', startTime: new Date(NOW.getTime() - 9e6), fetchedAt: NOW, seasonType: 'regular' },
  { homeTeam: 'NYG', awayTeam: 'DAL', status: nightStatus, startTime: new Date(NOW.getTime() + (nightStatus === 'final' ? -9e6 : 3e6)), fetchedAt: NOW, seasonType: 'regular' },
]
const rosters = [
  { rosterId: 'A', players: ['qa', 'w1', 'w2'], inactive: [], scoreboard: 28 },
  { rosterId: 'B', players: ['qb', 'w3', 'w4'], inactive: [], scoreboard: 40 },
]

beforeEach(() => {
  vi.clearAllMocks()
  h.players.mockResolvedValue(players)
  h.projections.mockResolvedValue(['qa', 'w1', 'w2', 'qb', 'w3', 'w4'].map((id) => ({ playerId: id, stats: { stats: { pts: id === 'w2' ? 18 : 10 } } })))
  h.availability.mockResolvedValue({ unavailableBySleeperId: new Map([['w4', 'bye']]), atRiskBySleeperId: {} })
})

describe('loadBestBallField', () => {
  it('values a team with a Sunday-night player on what it can still score, and says the week is provisional', async () => {
    h.scores.mockResolvedValue([{ playerId: 'qa', points: 20 }, { playerId: 'w1', points: 8 }, { playerId: 'qb', points: 25 }, { playerId: 'w3', points: 15 }])
    h.games.mockResolvedValue(games('scheduled'))
    const field = await loadBestBallField({ league, platformLeagueId: 'P', season: 2026, week: 8, rosters })
    expect(field).toEqual({ available: true, provisional: true, finals: new Map([['A', 38], ['B', 40]]) })
    // On live points A (28) trails B (40) by 12; on projected finals the gap is 2 — A is not "in the cut" by 12.
  })

  it('once the last game is final the totals are the real best-ball scores and nothing is provisional', async () => {
    h.scores.mockResolvedValue([{ playerId: 'qa', points: 20 }, { playerId: 'w1', points: 8 }, { playerId: 'w2', points: 31 }, { playerId: 'qb', points: 25 }, { playerId: 'w3', points: 15 }])
    h.games.mockResolvedValue(games('final'))
    const field = await loadBestBallField({ league, platformLeagueId: 'P', season: 2026, week: 8, rosters: [{ ...rosters[0], scoreboard: 51 }, rosters[1]] })
    expect(field).toEqual({ available: true, provisional: false, finals: new Map([['A', 51], ['B', 40]]) })
  })

  it('one roster it cannot value makes the whole field unavailable, with the reason', async () => {
    h.scores.mockResolvedValue([])
    h.games.mockResolvedValue(games('scheduled'))
    h.players.mockResolvedValue(players.filter((p) => p.sleeperId !== 'w2'))
    const field = await loadBestBallField({ league, platformLeagueId: 'P', season: 2026, week: 8, rosters })
    expect(field.available).toBe(false)
    expect(field.available === false && field.reason).toMatch(/^roster A: /)
  })
})
