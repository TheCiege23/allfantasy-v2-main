// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The Competitive Edge loader (lib/competitive-edge/tradeEdgeLoader.ts): which league, which manager,
 * and — the part that matters for cost — that it READS the trade-history cache and never rebuilds it.
 */

const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  leagueTeam: { findUnique: vi.fn(), findFirst: vi.fn() },
  sportsDataCache: { findUnique: vi.fn() },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
// The builder of the cache must never run from here; importing the constant is all the loader may do.
const getTradeGrades = vi.hoisted(() => vi.fn())
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({
  TRADE_GRADES_CACHE_PREFIX: 'trade-grades:v2:',
  getTradeGrades,
}))

import { loadTradeEdge } from '@/lib/competitive-edge/tradeEdgeLoader'

const NOW = new Date('2026-09-24T18:00:00.000Z')
const PAYLOAD = {
  version: 2,
  fetchedAt: '2026-09-24T15:00:00.000Z',
  staleAsOf: null,
  sleeperLeagueId: 'SL1',
  seasonsScanned: ['2025', '2026'],
  missing: [],
  trades: [1, 2, 3].map((i) => ({
    id: `t${i}`,
    season: '2026',
    week: i,
    createdIso: `2026-09-0${i}T15:00:00.000Z`,
    sides: [
      { ownerId: 'u-tasha', playersIn: [{ position: 'WR' }], playersOut: [{ position: 'RB' }], picksIn: [], picksOut: [] },
      { ownerId: 'u-mike', playersIn: [{ position: 'RB' }], playersOut: [{ position: 'WR' }], picksIn: [], picksOut: [] },
    ],
  })),
}

const load = () =>
  loadTradeEdge({
    leagueId: 'L1',
    userId: 'viewer',
    opponentTeamExternalId: '3',
    deal: { theyGet: [{ kind: 'player', position: 'WR' }], theySend: [] },
    now: NOW,
  })

beforeEach(() => {
  for (const fn of [db.league.findUnique, db.leagueTeam.findUnique, db.leagueTeam.findFirst, db.sportsDataCache.findUnique, getTradeGrades]) fn.mockReset()
  db.league.findUnique.mockResolvedValue({ platform: 'sleeper', platformLeagueId: 'SL1' })
  db.leagueTeam.findUnique.mockResolvedValue({ externalId: '3', platformUserId: 'u-tasha', ownerName: 'tashaR', teamName: "Tasha's Titans" })
  db.leagueTeam.findFirst.mockResolvedValue({ platformUserId: 'u-you' })
  db.sportsDataCache.findUnique.mockResolvedValue({ data: PAYLOAD, expiresAt: new Date('2026-09-24T21:00:00.000Z') })
})

describe('loadTradeEdge', () => {
  it('reads the league’s cached history by its Sleeper id and matches the manager by Sleeper user id', async () => {
    const out = await load()
    expect(db.sportsDataCache.findUnique).toHaveBeenCalledWith({ where: { cacheKey: 'trade-grades:v2:SL1' } })
    expect(db.leagueTeam.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId_externalId: { leagueId: 'L1', externalId: '3' } } }),
    )
    expect(out.available).toBe(true)
    if (!out.available) return
    expect(out.data.manager).toEqual({ name: 'tashaR', teamExternalId: '3' })
    expect(out.data.coverage).toMatchObject({ trades: 3, stale: false, asOf: '2026-09-24T15:00:00.000Z' })
    expect(out.data.facts[0]!.text).toBe('tashaR took on a WR in 3 of their 3 trades (3 WRs in all).')
  })

  it('🛑 never rebuilds the history — a cache miss is a stated gap, not a provider call', async () => {
    db.sportsDataCache.findUnique.mockResolvedValue(null)
    const out = await load()
    expect(out).toEqual({
      available: false,
      reason: "This league's trade history hasn't been read yet. It loads with the Trades list on this page — analyze again in a moment.",
    })
    expect(getTradeGrades).not.toHaveBeenCalled()
  })

  it('an expired entry is still read, and marked stale', async () => {
    db.sportsDataCache.findUnique.mockResolvedValue({ data: PAYLOAD, expiresAt: new Date('2026-09-24T12:00:00.000Z') })
    const out = await load()
    expect(out.available && out.data.coverage.stale).toBe(true)
  })

  it('a failed last refresh (staleAsOf) is stale too', async () => {
    db.sportsDataCache.findUnique.mockResolvedValue({
      data: { ...PAYLOAD, staleAsOf: '2026-09-24T09:00:00.000Z' },
      expiresAt: new Date('2026-09-24T21:00:00.000Z'),
    })
    const out = await load()
    expect(out.available && out.data.coverage.stale).toBe(true)
  })

  it('another platform says it is not connected yet, naming the platform', async () => {
    db.league.findUnique.mockResolvedValue({ platform: 'espn', platformLeagueId: '555' })
    const out = await load()
    expect(out).toEqual({ available: false, reason: "Competitive Edge reads Sleeper trade history today. ESPN leagues aren't connected yet." })
    expect(db.sportsDataCache.findUnique).not.toHaveBeenCalled()
  })

  it('a team with no Sleeper manager behind it says so', async () => {
    db.leagueTeam.findUnique.mockResolvedValue({ externalId: '3', platformUserId: null, ownerName: 'x', teamName: 'y' })
    const out = await load()
    expect(out.available).toBe(false)
    expect(!out.available && out.reason).toMatch(/can't match this team to a Sleeper manager/)
  })
})
