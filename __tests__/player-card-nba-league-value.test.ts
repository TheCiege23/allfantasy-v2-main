import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 THE PLAYER CARD OUTSIDE THE NFL (2026-11-16, re-score item 12).
 *
 * The market chart (`PlayerValueSnapshot`, FantasyCalc), the ownership board and the league price are
 * NFL, keyed by Sleeper id — and Sleeper reuses its numbers across sports. An NBA card read them by his
 * NBA id and could show an NFL player's price. Outside the NFL none of them is read; an NBA card in an
 * NBA league shows his value on the league's own board, the trade grade's price.
 *
 * The NFL card in an NFL league is the CONTROL: the same harness does read the chart there.
 */

type Fn = (...a: any[]) => any
const overrides = vi.hoisted(() => ({}) as Record<string, Record<string, Fn>>)
const h = vi.hoisted(() => ({ snapshot: vi.fn(async () => []), rostered: vi.fn(), values: vi.fn(async () => null), board: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => {
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          overrides[name]?.[method] ??
          (async () => (method === 'findMany' || method === 'groupBy' ? [] : method === 'count' ? 0 : null)),
      },
    )
  return { prisma: new Proxy({}, { get: (_t, name: string) => (name.startsWith('$') ? async () => [] : model(name)) }) }
})
vi.mock('@/lib/league-access', () => ({ memberLeaguePlatformIdsFor: vi.fn(async () => []) }))
vi.mock('@/lib/waiver-wire/watchlist-service', () => ({ isWatched: vi.fn(async () => false) }))
vi.mock('@/lib/follows/playerFollows', () => ({ followKeyFor: () => null, isFollowingPlayer: vi.fn(async () => null) }))
vi.mock('@/lib/injuries/injurySyncState', () => ({ readInjurySyncFreshness: vi.fn(async () => null) }))
vi.mock('@/lib/core-app/rosteredMarket', () => ({ getRosteredMarket: h.rostered }))
vi.mock('@/lib/core-app/playerProjections', () => ({
  latestProjectionWeek: vi.fn(async () => null),
  lookupProjections: vi.fn(async () => new Map()),
  lookupAfEngineProjections: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/core-app/archivedTradeGrade', () => ({ gradeArchivedTradeRows: vi.fn(async () => new Map()) }))
vi.mock('@/lib/core-app/playerTradeVisual', () => ({ marketContextFor: () => ({ teams: 12 }) }))
vi.mock('@/lib/trade-intel/marketValueService', () => ({ getMarketValues: h.values, playerValue: () => 9999 }))
vi.mock('@/lib/sport-values/leagueValueBoard', async (orig) => ({
  ...(await orig<typeof import('@/lib/sport-values/leagueValueBoard')>()),
  loadLeagueValueBoard: h.board,
}))

import { getPlayerCard } from '@/lib/core-app/playerCard'
import type { SportPointsContext } from '@/lib/decision-os/trade/sportPointsValue'

const HIM = '4866'

function setup(sport: 'NBA' | 'NFL') {
  overrides.league = {
    findUnique: async () => ({ id: 'L1', name: 'The League', platform: 'sleeper', sport, settings: {}, leagueType: 'redraft', platformLeagueId: 'P1', isDynasty: false }),
    findMany: async () => [],
  }
  overrides.sportsPlayer = {
    findFirst: async () => ({
      externalId: HIM, sleeperId: HIM, sport, name: 'Hoop Star', position: 'PG', team: 'BOS',
      number: null, imageUrl: null, age: null, height: null, weight: null, yearsExp: null, college: null,
    }),
    findMany: async (args: { where?: { position?: unknown } }) => (args?.where?.position ? [{ sleeperId: '111', name: 'My Other Guard' }] : []),
  }
  overrides.playerValueSnapshot = { findMany: h.snapshot }
  overrides.roster = {
    findMany: async () => [
      { id: 'r-them', platformUserId: 'them', playerData: { players: [HIM], starters: [HIM] } },
      { id: 'r-me', platformUserId: 'me', playerData: { players: ['111'], starters: [] } },
    ],
  }
  overrides.leagueTeam = {
    findMany: async () => [{ id: 't2', externalId: '2', platformUserId: 'me', claimedByUserId: 'u1', ownerName: 'me', teamName: 'Mine' }],
  }
}

const ctx = (over: Partial<SportPointsContext> = {}): SportPointsContext => ({
  sport: 'NBA',
  board: [{ id: 'pim-1', name: 'Hoop Star', position: 'PG', perGame: 40, sampleGames: 26, aliases: [HIM] }],
  replacementByPosition: new Map([['PG', { name: 'Wire Guard', perGame: 28 }]]),
  window: { season: 2026, seasonLabel: '2026-27', gamesRemaining: 60, baselineSeasonLabel: '2025-26' },
  scoringBasis: 'league',
  teams: 12,
  ...over,
})

beforeEach(() => {
  for (const k of Object.keys(overrides)) delete overrides[k]
  vi.clearAllMocks()
  h.rostered.mockResolvedValue({ byPlayerId: new Map(), leaguesCounted: 100 })
  h.board.mockImplementation(async () => {
    const c = ctx()
    return { kind: 'ok', sport: 'NBA', ctx: c, byId: new Map(c.board.map((p) => [p.id, p])) }
  })
})

describe('getPlayerCard — an NBA card never reads the NFL chart', () => {
  it('[control] an NFL card in an NFL league reads the chart, the ownership board and the league price', async () => {
    setup('NFL')
    const card = await getPlayerCard({ sport: 'NFL', sleeperId: HIM, leagueId: 'L1', userId: 'u1' })
    expect(h.snapshot).toHaveBeenCalled()
    expect(h.rostered).toHaveBeenCalled()
    expect(h.values).toHaveBeenCalled()
    expect(h.board).not.toHaveBeenCalled()
    expect(card!.league!.boardValue).toBeUndefined()
  })

  it('🛑 an NBA card in an NBA league reads none of them, and says so in words', async () => {
    setup('NBA')
    const card = await getPlayerCard({ sport: 'NBA', sleeperId: HIM, leagueId: 'L1', userId: 'u1' })
    expect(h.snapshot).not.toHaveBeenCalled()
    expect(h.rostered).not.toHaveBeenCalled()
    expect(h.values).not.toHaveBeenCalled()
    expect(card!.market).toEqual({ available: false, reason: 'Market prices are published for NFL players only.' })
    expect(card!.ownership).toEqual({ available: false, reason: 'Ownership rates are counted across NFL leagues only.' })
    expect(card!.league!.price).toEqual({ available: false, reason: 'This league values its players on its own value board, not on the NFL market chart.' })
    // Your depth at the position still lists your players — with no stranger's price beside them.
    expect(card!.league!.yourRoster).toEqual([{ name: 'My Other Guard', value: null }])
  })

  it('…and shows his value on the league’s own board: the trade grade’s price, with the games behind it', async () => {
    setup('NBA')
    const card = await getPlayerCard({ sport: 'NBA', sleeperId: HIM, leagueId: 'L1', userId: 'u1' })
    expect(h.board).toHaveBeenCalledWith('L1')
    expect(card!.league!.boardValue).toEqual({
      available: true,
      data: {
        sport: 'NBA', unit: 'fantasy points', perGame: 40, replacementPerGame: 28, replacementName: 'Wire Guard',
        value: (40 - 28) * 60, gamesRemaining: 60, scheduleKnown: true, seasonLabel: '2026-27', sample: { kind: 'games', count: 26, thin: false }, baselineSeasonLabel: '2025-26',
        dynastyValue: null, age: null,
      },
    })
  })

  it('a board that cannot price him says why, in the board’s own words', async () => {
    setup('NBA')
    h.board.mockResolvedValue({ kind: 'unavailable', sport: 'NBA', reason: 'Only 40% of the board clears the sample bar.' })
    const card = await getPlayerCard({ sport: 'NBA', sleeperId: HIM, leagueId: 'L1', userId: 'u1' })
    expect(card!.league!.boardValue).toEqual({ available: false, reason: 'Only 40% of the board clears the sample bar.' })
  })

  it('an NBA card opened in an NFL league reads no board — the league is not his sport', async () => {
    setup('NBA')
    overrides.league!.findUnique = async () => ({ id: 'L1', name: 'The League', platform: 'sleeper', sport: 'NFL', settings: {}, leagueType: 'redraft', platformLeagueId: 'P1', isDynasty: false })
    const card = await getPlayerCard({ sport: 'NBA', sleeperId: HIM, leagueId: 'L1', userId: 'u1' })
    expect(h.board).not.toHaveBeenCalled()
    expect(card!.league?.boardValue).toBeUndefined()
  })
})
