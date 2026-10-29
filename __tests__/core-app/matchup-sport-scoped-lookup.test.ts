// @vitest-environment node
/**
 * 🛑 /core/matchup NEVER PUTS A PLAYER FROM ANOTHER SPORT ON THE BOARD.
 *
 * Both the board (`getMatchupData`) and its pricing (`loadSideProjections`) joined `SportsPlayer` on
 * `sleeperId` alone. Sleeper numbers its NFL and NBA pools independently, so an NBA starter's id can
 * equal an NFL player's — and the unscoped join named that NFL player in the cell, and read his
 * injury status into the NBA side's projected total.
 *
 * The prisma double honours a `sport` filter when the caller sends one, as Postgres would, and
 * ignores it when the caller does not — so an unscoped query is exactly what lets the stranger in.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeagueContext } from '@/lib/core-app/leagueContext'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({
  sport: 'NBA',
  bestBall: false,
  injuries: [] as Array<{ playerName: string; status: string }>,
  rows: [
    // "1001" is only an NFL player; "2002" is an NBA player AND (a different) NFL player.
    { sleeperId: '1001', name: 'NFL Namesake', position: 'WR', team: 'NYJ', sport: 'NFL', imageUrl: null, source: 'sleeper', fetchedAt: new Date(0) },
    { sleeperId: '2002', name: 'NBA Guard', position: 'PG', team: 'BOS', sport: 'NBA', imageUrl: null, source: 'sleeper', fetchedAt: new Date(0) },
    { sleeperId: '2002', name: 'NFL Other Namesake', position: 'RB', team: 'KC', sport: 'NFL', imageUrl: null, source: 'sleeper', fetchedAt: new Date(0) },
  ],
}))

const sportsPlayerFindMany = vi.hoisted(() =>
  vi.fn(async (args: { where: { sport?: string; sleeperId: { in: string[] } } }) =>
    db.rows.filter(
      (r) => args.where.sleeperId.in.includes(r.sleeperId) && (args.where.sport == null || r.sport === args.where.sport),
    ),
  ),
)

vi.mock('@/lib/prisma', () => {
  const fallback = (method: string) =>
    method === 'count' ? 0 : method === 'findMany' || method === 'groupBy' ? [] : null
  const answers: Record<string, (args: any) => unknown> = {
    'sportsPlayer.findMany': (args) => sportsPlayerFindMany(args),
    'weeklyMatchup.findMany': () => [
      { rosterId: '1', matchupId: 7, pointsFor: 0, pointsAgainst: 0, win: null },
      { rosterId: '2', matchupId: 7, pointsFor: 0, pointsAgainst: 0, win: null },
    ],
    'leagueTeam.findMany': () => [
      { externalId: '1', teamName: 'Mine', ownerName: 'me', wins: 0, losses: 0, ties: 0, platformUserId: 'u1', avatarUrl: null },
      { externalId: '2', teamName: 'Theirs', ownerName: 'them', wins: 0, losses: 0, ties: 0, platformUserId: 'u2', avatarUrl: null },
    ],
    'league.findUnique': () => ({ settings: { scoring_settings: { pts: 1 } }, platform: 'sleeper', sport: db.sport, bestBallMode: db.bestBall }),
    'roster.findMany': () => [
      { platformUserId: 'you', playerData: { starters: ['1001', '2002'] } },
      { platformUserId: 'them', playerData: { starters: ['2002'] } },
    ],
    'fantasyProjection.findMany': (args) =>
      args.where.playerId.in.map((playerId: string) => ({ playerId, stats: { stats: { pts: 10 } } })),
    'sportsInjury.findMany': (args) => db.injuries.filter((i) => args.where.playerName.in.includes(i.playerName)),
  }
  const modelProxy = (model: string) =>
    new Proxy({}, { get: (_t, method: string) => vi.fn(async (args: unknown) => (answers[`${model}.${method}`] ?? (() => fallback(method)))(args)) })
  const prisma = new Proxy({}, {
    get: (_t, key: string) => {
      if (key.startsWith('$query') || key.startsWith('$execute')) return vi.fn(async () => [])
      if (key === 'then') return undefined
      return modelProxy(key)
    },
  })
  return { prisma, default: prisma }
})

vi.mock('@/lib/core-app/currentWeek', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveCurrentWeekForLeague: vi.fn(async () => ({ seasonYear: 2026, week: 3 })),
}))
vi.mock('@/lib/core-app/finishedNflWeeks', () => ({ loadFinishedNflWeeks: vi.fn(async () => new Set()) }))
vi.mock('@/lib/core-app/matchupWinInputs', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  loadMatchupSides: vi.fn(async () => ({
    you: { starters: [], unprojected: 0, projectedRemaining: 0, lineup: [{ playerId: '1001', projected: null }, { playerId: '2002', projected: null }] },
    opponent: { starters: [], unprojected: 0, projectedRemaining: 0, lineup: [{ playerId: '2002', projected: null }] },
    leagueScoring: { available: false, reason: 'test' },
    atRiskBySleeperId: {},
  })),
}))

import { getMatchupData } from '@/lib/core-app/matchup'
import { loadSideProjections } from '@/lib/core-app/matchupProjections'

const context = () =>
  ({
    leagueId: 'L',
    userId: 'u',
    league: async () => ({ id: 'L', name: 'Hoops', platform: 'sleeper', platformLeagueId: 'p1', sport: db.sport, season: 2026, status: 'in_season', settings: {} }),
    claimedTeam: async () => ({ externalId: '1', platformUserId: 'u1' }),
    claimedTeams: async () => [],
  }) as unknown as LeagueContext

async function boardNames(): Promise<string[]> {
  const data = await getMatchupData('L', 'u', null, context())
  if (!data?.lineups.available) throw new Error(`no lineups: ${JSON.stringify(data?.lineups)}`)
  return data.lineups.data.flatMap((s) => [s.you?.name, s.opponent?.name]).filter((n): n is string => Boolean(n))
}

beforeEach(() => {
  db.sport = 'NBA'
  db.bestBall = false
  db.injuries = []
})

describe('Matchup board — player identity is scoped to the league sport', () => {
  it('control: the NBA player the lineup holds IS named', async () => {
    expect(await boardNames()).toContain('NBA Guard')
  })

  it('🛑 an NBA board never names the NFL player who shares a Sleeper id', async () => {
    const names = await boardNames()
    expect(names).not.toContain('NFL Namesake')
    expect(names).not.toContain('NFL Other Namesake')
  })

  it('and the mirror: an NFL board never names the NBA player sharing an id', async () => {
    db.sport = 'NFL'
    const names = await boardNames()
    expect(names).toContain('NFL Namesake')
    expect(names).not.toContain('NBA Guard')
  })
})

describe('Matchup pricing — an NFL namesake’s injury never zeroes an NBA starter', () => {
  const load = () =>
    loadSideProjections({ leagueId: 'L', season: 2026, week: 3, yourPlatformUserId: 'you', opponentPlatformUserId: 'them' })

  it('control: the NBA player’s own OUT does zero him', async () => {
    db.injuries = [{ playerName: 'NBA Guard', status: 'Out' }]
    const sides = await load()
    expect(sides?.you.lineup.find((s) => s.playerId === '2002')).toMatchObject({ projected: 0, unavailable: 'out' })
  })

  it('🛑 an NFL player sharing the id is not read as the NBA starter', async () => {
    db.injuries = [{ playerName: 'NFL Namesake', status: 'Out' }]
    const sides = await load()
    expect(sides?.you.lineup.find((s) => s.playerId === '1001')?.unavailable ?? null).toBeNull()
  })

  it('🛑 every SportsPlayer read it makes names the league sport', async () => {
    sportsPlayerFindMany.mockClear()
    await load()
    expect(sportsPlayerFindMany).toHaveBeenCalled()
    for (const [args] of sportsPlayerFindMany.mock.calls) expect(args.where.sport).toBe('NBA')
  })

  it('🛑 and so does the Best Ball position read', async () => {
    db.bestBall = true
    sportsPlayerFindMany.mockClear()
    await load()
    expect(sportsPlayerFindMany.mock.calls.length).toBeGreaterThanOrEqual(2)
    for (const [args] of sportsPlayerFindMany.mock.calls) expect(args.where.sport).toBe('NBA')
  })
})
