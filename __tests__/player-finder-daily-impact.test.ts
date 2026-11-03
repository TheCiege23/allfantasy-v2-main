import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: { findMany: vi.fn() }, leagueTeam: { findMany: vi.fn() }, roster: { findMany: vi.fn() },
  playerIdentityMap: { findMany: vi.fn() }, sportsPlayer: { findMany: vi.fn() },
  aFProjectionSnapshot: { findFirst: vi.fn(), findMany: vi.fn() },
}))
const outlook = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/projections/dailySportOutlook', () => ({ loadDailySportOutlook: outlook }))
vi.mock('@/lib/redraft/sportConfig', () => ({ getRedraftSportConfig: () => ({ flexPositions: {} }) }))

import { getFinderDailyImpact } from '@/lib/core-app/playerFinderDailyImpact'

const subject = { sport: 'NBA', source: 'rolling_insights', externalId: '340', sleeperId: null,
  name: 'Jordan Smith', position: 'PG', team: 'Boston Celtics' }
const slot = { leagueId: 'L', leagueName: 'NBA Points', platform: 'manual', format: null,
  platformLeagueId: null, season: 2026, teamExternalId: '1', slot: 'STARTER', isYours: true,
  owner: null, bestBall: false }
const identities = ['340', '341', '342', '343'].map((id) => ({ id: `identity-${id}`,
  canonicalName: id === '340' ? 'Jordan Smith' : `Player ${id}`, position: 'PG',
  rollingInsightsId: id, sleeperNbaId: null, fantraxId: null }))
const players = ['340', '341', '342', '343'].map((id) => ({ name: id === '340' ? 'Jordan Smith' : `Player ${id}`,
  position: 'PG', team: 'Boston Celtics', status: null, source: 'rolling_insights', externalId: id, sleeperId: null }))

beforeEach(() => {
  vi.clearAllMocks()
  db.league.findMany.mockResolvedValue([{ id: 'L', sport: 'NBA', platform: 'manual', platformLeagueId: null,
    season: 2026, settings: { roster_positions: ['PG', 'SG', 'BN'] } }])
  db.leagueTeam.findMany.mockResolvedValue([{ leagueId: 'L', platformUserId: 'me', externalId: '1' }])
  db.roster.findMany.mockResolvedValue([
    { leagueId: 'L', platformUserId: 'me', playerData: { players: ['340', '341', '343'], starters: ['340', '341'] } },
    { leagueId: 'L', platformUserId: 'other', playerData: { players: ['999'] } },
  ])
  db.playerIdentityMap.findMany.mockImplementation(async ({ where }: { where: { id?: { in: string[] } } }) =>
    where.id ? identities.filter((row) => where.id!.in.includes(row.id)) : identities.filter((row) => row.rollingInsightsId !== '342'))
  db.sportsPlayer.findMany.mockImplementation(async ({ where }: { where: { source?: string } }) =>
    where.source ? players.filter((row) => row.externalId === '342') : players.filter((row) => row.externalId !== '342'))
  db.aFProjectionSnapshot.findFirst.mockResolvedValue({ season: 2026 })
  db.aFProjectionSnapshot.findMany.mockResolvedValue([{ playerId: 'identity-342' }])
  outlook.mockResolvedValue({ byKey: new Map([
    ['roster:340', { projectedPoints: 10 }], ['roster:341', { projectedPoints: 8 }],
    ['roster:343', { projectedPoints: 12 }], ['pool:342', { projectedPoints: 18 }],
  ]), period: { kind: 'day', season: 2026, week: 2, day: '2026-11-03' } })
})

describe('Player Finder daily-sport advice', () => {
  it('uses league-scored period points for a bench swap and a verified unrostered pickup', async () => {
    const result = await getFinderDailyImpact(subject, [slot], 'u1', true)
    expect(result.impact).toHaveLength(1)
    expect(result.impact[0].afPoints).toMatchObject({ available: true, data: { points: 10 } })
    expect(result.impact[0].replacements).toMatchObject({ available: true,
      data: [expect.objectContaining({ playerId: '343', delta: 2 })] })
    expect(result.moves).toMatchObject([{ scoringBasis: 'league', periodLabel: 'today',
      freeAgents: [expect.objectContaining({ playerId: '342', delta: 8 })] }])
    expect(outlook).toHaveBeenCalledWith(db, expect.objectContaining({
      league: expect.objectContaining({ sport: 'NBA' }),
      players: expect.arrayContaining([expect.objectContaining({ key: 'roster:340', lookupId: 'identity-340' })]),
    }))
  })

  it('does not claim an RI player is available when a native roster uses unmapped TSDB ids', async () => {
    db.roster.findMany.mockResolvedValue([
      { leagueId: 'L', platformUserId: 'me', playerData: { players: ['340', 'tsdb_77'], starters: ['340'] } },
    ])
    const result = await getFinderDailyImpact(subject, [slot], 'u1', true)
    expect(result.moves).toEqual([])
    expect(db.aFProjectionSnapshot.findMany).not.toHaveBeenCalled()
  })
})
