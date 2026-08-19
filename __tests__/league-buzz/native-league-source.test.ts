// @vitest-environment node
/**
 * AF_LEAGUE_BUZZ §8 — native AF league DB events + the bounded-fan-out performance guard. The
 * source must query ONLY the viewer's native leagues (never Sleeper-imported ones), with a bounded
 * `take`, and render real trades/waivers/announcements/chat into honest text — no fabrication.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { prismaMock, namesMock } = vi.hoisted(() => ({
  prismaMock: {
    afLeagueTrade: { findMany: vi.fn() },
    waiverResult: { findMany: vi.fn() },
    leagueChatMessage: { findMany: vi.fn() },
    roster: { findMany: vi.fn() },
    appUser: { findMany: vi.fn() },
  },
  namesMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/roster/resolvePlayerNames', () => ({ resolvePlayerNamesForSport: namesMock }))

import { collectNativeLeagueActivity } from '@/lib/activity/sources/nativeLeagueActivity'

const D = (iso: string) => new Date(iso)

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.afLeagueTrade.findMany.mockResolvedValue([])
  prismaMock.waiverResult.findMany.mockResolvedValue([])
  prismaMock.leagueChatMessage.findMany.mockResolvedValue([])
  prismaMock.roster.findMany.mockResolvedValue([])
  prismaMock.appUser.findMany.mockResolvedValue([])
  namesMock.mockResolvedValue(new Map())
})

const leagues = [
  { id: 'L1', platform: 'allfantasy', name: 'Dynasty Kings', sport: 'NFL' },
  { id: 'S1', platform: 'sleeper', platformLeagueId: '999', name: 'Imported' },
]

describe('collectNativeLeagueActivity — native DB events (§8)', () => {
  it('queries ONLY native leagues (never Sleeper) with a bounded take', async () => {
    await collectNativeLeagueActivity({ userId: 'u1', leagues, limit: 50 })

    for (const q of [prismaMock.afLeagueTrade.findMany, prismaMock.waiverResult.findMany, prismaMock.leagueChatMessage.findMany]) {
      expect(q).toHaveBeenCalledTimes(1)
      const arg = q.mock.calls[0][0]
      expect(arg.where.leagueId.in).toEqual(['L1']) // 'S1' (Sleeper) is excluded
      expect(typeof arg.take).toBe('number') // bounded fan-out
    }
  })

  it('renders real trades, waivers, announcements, and chat into honest text', async () => {
    prismaMock.afLeagueTrade.findMany.mockResolvedValue([
      {
        id: 't1',
        leagueId: 'L1',
        processedAt: D('2026-07-12T10:00:00.000Z'),
        items: [
          { itemType: 'player', itemReference: 'pA', toRosterId: 'rB', faabAmount: null },
          { itemType: 'player', itemReference: 'pB', toRosterId: 'rA', faabAmount: null },
        ],
      },
    ])
    prismaMock.waiverResult.findMany.mockResolvedValue([
      { id: 'w1', leagueId: 'L1', rosterId: 'rA', addPlayerId: 'pC', dropPlayerId: 'pD', createdAt: D('2026-07-11T10:00:00.000Z') },
    ])
    prismaMock.leagueChatMessage.findMany.mockResolvedValue([
      { id: 'c1', leagueId: 'L1', message: 'Playoffs start Sunday!', messageSubtype: 'global_broadcast', createdAt: D('2026-07-13T10:00:00.000Z'), user: { displayName: 'Commish' } },
      { id: 'c2', leagueId: 'L1', message: 'gg all', messageSubtype: null, createdAt: D('2026-07-10T10:00:00.000Z'), user: { displayName: 'Bob' } },
    ])
    prismaMock.roster.findMany.mockResolvedValue([
      { id: 'rA', platformUserId: 'uA' },
      { id: 'rB', platformUserId: 'uB' },
    ])
    prismaMock.appUser.findMany.mockResolvedValue([
      { id: 'uA', displayName: 'Alice', username: 'alice' },
      { id: 'uB', displayName: 'Bob', username: 'bob' },
    ])
    namesMock.mockResolvedValue(new Map([['pA', 'Player A'], ['pB', 'Player B'], ['pC', 'Player C'], ['pD', 'Player D']]))

    const items = await collectNativeLeagueActivity({ userId: 'u1', leagues, limit: 50 })
    const byType = (t: string) => items.filter((i) => i.type === t)

    expect(byType('trade')).toHaveLength(1)
    expect(byType('trade')[0].description).toBe('Bob gets Player A · Alice gets Player B')
    expect(byType('waiver')[0].description).toBe('Alice claimed Player C, dropped Player D')
    expect(byType('announcement')[0].description).toBe('Playoffs start Sunday!')
    expect(byType('message')[0].description).toBe('Bob: gg all')

    for (const item of items) {
      expect(item.source).toBe('native')
      expect(item.href).toBe('/league/L1')
      expect(item.leagueName).toBe('Dynasty Kings')
    }
  })

  it('returns empty and issues no query when the viewer has no native leagues', async () => {
    const items = await collectNativeLeagueActivity({
      userId: 'u1',
      leagues: [{ id: 'S1', platform: 'sleeper', platformLeagueId: '999' }],
      limit: 50,
    })
    expect(items).toEqual([])
    expect(prismaMock.afLeagueTrade.findMany).not.toHaveBeenCalled()
  })
})
