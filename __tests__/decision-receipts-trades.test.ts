// @vitest-environment node
/**
 * Trade receipts (retention item 6, 2026-09-14): how YOUR trades turned out, from the grade
 * cache the sweep already fills. Net points, never the letter; too early withheld, never
 * shown as even; losses stated as plainly as wins.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ cacheFindMany: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsDataCache: { findMany: h.cacheFindMany } } }))
// The service module is server-only and pulls providers; receipts need only its constant and types.
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({ TRADE_GRADES_CACHE_PREFIX: 'trade-grades:v2:' }))

import { MAX_TRADE_RECEIPTS, MIN_WEEKS_FOR_RECEIPT, getTradeReceipts } from '@/lib/core-app/decisionReceipts'

const ME = 'sleeper-me'
const LEAGUE = { id: 'af-1', name: 'Ice Kings', platform: 'sleeper', platformLeagueId: '998877' }

const asset = (name: string, credited: Record<string, number>) => ({
  playerId: name, name, position: 'RB', pointsBySeason: {}, creditedBySeason: credited, departed: null, gamesMissedBySeason: {},
})

function side(over: Record<string, unknown> = {}) {
  return {
    rosterId: 1, ownerId: ME, managerName: 'me', teamName: 'My Team', avatar: null,
    playersIn: [], playersOut: [], picksIn: [], picksOut: [], madePlayoffs: null,
    seasonNets: [{ season: '2026', net: 0, partial: true }], cumulativeNet: 0,
    initialGrade: 'C', currentGrade: 'C', trend: 'steady',
    ...over,
  }
}

function trade(id: string, mine: Record<string, unknown>, theirs: Record<string, unknown> = {}, over: Record<string, unknown> = {}) {
  return {
    id, season: '2026', week: 1, createdIso: '2026-09-10T00:00:00.000Z', multiTeam: false, tie: false, hasPendingPicks: false,
    sides: [side(mine), side({ rosterId: 2, ownerId: 'them', managerName: 'rival', teamName: 'Gridiron Vultures', ...theirs })],
    ...over,
  }
}

const cacheRow = (trades: unknown[]) => ({ cacheKey: 'trade-grades:v2:998877', data: { version: 2, trades } })

beforeEach(() => {
  h.cacheFindMany.mockReset()
})

describe('getTradeReceipts', () => {
  it('🛑 YOUR side, net points since, and it says you are ahead — reading the one cache key', async () => {
    h.cacheFindMany.mockResolvedValue([
      cacheRow([
        trade('t1', {
          playersIn: [asset('Jahmyr Gibbs', { '2026': 88.4 })],
          playersOut: [asset('Sam LaPorta', { '2026': 20.0 })],
        }),
      ]),
    ])
    const out = await getTradeReceipts({ leagues: [LEAGUE], ownerSleeperId: ME, currentWeek: 6 })

    expect(h.cacheFindMany.mock.calls[0][0].where.cacheKey.in).toEqual(['trade-grades:v2:998877'])
    expect(out?.trades).toHaveLength(1)
    expect(out?.trades[0]).toMatchObject({
      leagueName: 'Ice Kings',
      counterparty: 'Gridiron Vultures',
      got: ['Jahmyr Gibbs'],
      gave: ['Sam LaPorta'],
      gotPoints: 88.4,
      gavePoints: 20,
      netPoints: 68.4,
      outcome: 'ahead',
      ongoing: true,
      href: '/core/trades?league=af-1',
    })
  })

  it('🛑 a losing trade is stated plainly as behind', async () => {
    h.cacheFindMany.mockResolvedValue([
      cacheRow([trade('t1', { playersIn: [asset('A', { '2026': 10 })], playersOut: [asset('B', { '2026': 95 })] })]),
    ])
    const out = await getTradeReceipts({ leagues: [LEAGUE], ownerSleeperId: ME, currentWeek: 6 })
    expect(out?.trades[0]).toMatchObject({ netPoints: -85, outcome: 'behind' })
  })

  it('inside the engine’s tie band is about even', async () => {
    h.cacheFindMany.mockResolvedValue([
      cacheRow([trade('t1', { playersIn: [asset('A', { '2026': 40 })], playersOut: [asset('B', { '2026': 10 })] })]),
    ])
    const out = await getTradeReceipts({ leagues: [LEAGUE], ownerSleeperId: ME, currentWeek: 6 })
    expect(out?.trades[0].outcome).toBe('even')
  })

  it('🛑 nobody scored yet → withheld as too early, never shown as even', async () => {
    h.cacheFindMany.mockResolvedValue([
      cacheRow([trade('t1', { playersIn: [asset('A', {})], playersOut: [asset('B', {})] })]),
    ])
    const out = await getTradeReceipts({ leagues: [LEAGUE], ownerSleeperId: ME, currentWeek: 9 })
    expect(out).toEqual({ trades: [], tooEarly: 1, uncoveredLeagues: 0 })
  })

  it(`🛑 fewer than ${MIN_WEEKS_FOR_RECEIPT} weeks into a season still being played → too early`, async () => {
    const t = trade('t1', { playersIn: [asset('A', { '2026': 30 })], playersOut: [] }, {}, { week: 4 })
    h.cacheFindMany.mockResolvedValue([cacheRow([t])])
    const early = await getTradeReceipts({ leagues: [LEAGUE], ownerSleeperId: ME, currentWeek: 4 + MIN_WEEKS_FOR_RECEIPT - 1 })
    expect(early?.tooEarly).toBe(1)
    const ready = await getTradeReceipts({ leagues: [LEAGUE], ownerSleeperId: ME, currentWeek: 4 + MIN_WEEKS_FOR_RECEIPT })
    expect(ready?.trades).toHaveLength(1)
  })

  it('unknown current week withholds a current-season trade', async () => {
    h.cacheFindMany.mockResolvedValue([cacheRow([trade('t1', { playersIn: [asset('A', { '2026': 30 })] })])])
    const out = await getTradeReceipts({ leagues: [LEAGUE], ownerSleeperId: ME, currentWeek: null })
    expect(out?.tooEarly).toBe(1)
  })

  it('a finished season is never too early, and points add up across seasons', async () => {
    const t = trade(
      't1',
      {
        playersIn: [asset('A', { '2025': 120, '2026': 30 })],
        playersOut: [asset('B', { '2025': 50 })],
        seasonNets: [{ season: '2025', net: 70, partial: false }, { season: '2026', net: 30, partial: true }],
      },
      {},
      { season: '2025', week: 14 },
    )
    h.cacheFindMany.mockResolvedValue([cacheRow([t])])
    const out = await getTradeReceipts({ leagues: [LEAGUE], ownerSleeperId: ME, currentWeek: 1 })
    expect(out?.trades[0]).toMatchObject({ gotPoints: 150, gavePoints: 50, netPoints: 100, ongoing: true })
  })

  it('trades you were not part of are not your receipts', async () => {
    h.cacheFindMany.mockResolvedValue([
      cacheRow([trade('t1', { ownerId: 'someone', playersIn: [asset('A', { '2026': 99 })] })]),
    ])
    const out = await getTradeReceipts({ leagues: [LEAGUE], ownerSleeperId: ME, currentWeek: 9 })
    expect(out).toEqual({ trades: [], tooEarly: 0, uncoveredLeagues: 0 })
  })

  it('counts undrafted picks, names picks by label, and counts leagues the grades do not cover', async () => {
    h.cacheFindMany.mockResolvedValue([
      cacheRow([
        trade('t1', {
          playersIn: [asset('A', { '2026': 70 })],
          picksOut: [{ season: '2027', round: 1, originalRosterId: 1, label: '2027 round 1', resolved: null, pending: true, rerouted: false }],
        }),
      ]),
    ])
    const out = await getTradeReceipts({
      leagues: [LEAGUE, { id: 'af-2', name: 'ESPN One', platform: 'espn', platformLeagueId: '1' }],
      ownerSleeperId: ME,
      currentWeek: 9,
    })
    expect(out?.trades[0]).toMatchObject({ gave: ['2027 round 1'], unsettledPicks: 1 })
    expect(out?.uncoveredLeagues).toBe(1)
  })

  it(`newest first, at most ${MAX_TRADE_RECEIPTS}`, async () => {
    const many = Array.from({ length: MAX_TRADE_RECEIPTS + 2 }, (_, i) =>
      trade(`t${i}`, { playersIn: [asset('A', { '2026': 90 })] }, {}, { createdIso: `2026-09-0${i + 1}T00:00:00.000Z` }),
    )
    h.cacheFindMany.mockResolvedValue([cacheRow(many)])
    const out = await getTradeReceipts({ leagues: [LEAGUE], ownerSleeperId: ME, currentWeek: 9 })
    expect(out?.trades).toHaveLength(MAX_TRADE_RECEIPTS)
    expect(out?.trades[0].id).toBe(`t${MAX_TRADE_RECEIPTS + 1}`)
  })

  it('🛑 without your Sleeper id, or with no Sleeper league, there is no card — and no read', async () => {
    expect(await getTradeReceipts({ leagues: [LEAGUE], ownerSleeperId: null, currentWeek: 9 })).toBeNull()
    expect(
      await getTradeReceipts({ leagues: [{ ...LEAGUE, platform: 'espn' }], ownerSleeperId: ME, currentWeek: 9 }),
    ).toBeNull()
    expect(h.cacheFindMany).not.toHaveBeenCalled()
  })
})
