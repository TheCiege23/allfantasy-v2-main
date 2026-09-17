import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/*
 * The player card's trade history is scoped to the viewer.
 *
 * 🛑 WHAT THIS PINS: `/api/core/player-card` does not require a session, and the universal card used
 * to call `loadTrades` with no scope at all — so a signed-out request got every trade involving the
 * player across every league we hold, with those leagues' names. Every call now carries a scope,
 * and a signed-out or league-less viewer is refused before any trade row is read.
 */

const tradeFindMany = vi.fn()
const leagueFindMany = vi.fn()
const playerFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTrade: { findMany: (...a: unknown[]) => tradeFindMany(...a) },
    league: { findMany: (...a: unknown[]) => leagueFindMany(...a) },
    sportsPlayer: { findMany: (...a: unknown[]) => playerFindMany(...a) },
  },
}))

beforeEach(() => {
  vi.resetModules()
  tradeFindMany.mockReset().mockResolvedValue([])
  leagueFindMany.mockReset().mockResolvedValue([])
  playerFindMany.mockReset().mockResolvedValue([])
})

const trade = (transactionId: string, leagueId: string) => ({
  transactionId,
  platform: 'sleeper',
  tradeDate: new Date('2026-09-10T12:00:00Z'),
  playersGiven: ['111'],
  playersReceived: ['6813'],
  picksGiven: [],
  picksReceived: [],
  history: { sleeperLeagueId: leagueId },
})

describe('loadTrades — every read is scoped', () => {
  it('refuses a signed-out viewer without reading any trade', async () => {
    const { loadTrades } = await import('@/lib/core-app/playerCard')
    const out = await loadTrades('6813', { viewerLeagueIds: null })
    expect(out.available).toBe(false)
    expect(out.available === false && out.reason).toMatch(/sign in/i)
    expect(tradeFindMany).not.toHaveBeenCalled()
    expect(leagueFindMany).not.toHaveBeenCalled()
  })

  it('refuses a malformed scope the same way, never falling through to a query', async () => {
    const { loadTrades } = await import('@/lib/core-app/playerCard')
    const out = await loadTrades('6813', {} as never)
    expect(out.available).toBe(false)
    expect(tradeFindMany).not.toHaveBeenCalled()
  })

  it('refuses a signed-in viewer with no leagues without reading any trade', async () => {
    const { loadTrades } = await import('@/lib/core-app/playerCard')
    const out = await loadTrades('6813', { viewerLeagueIds: [] })
    expect(out.available).toBe(false)
    expect(out.available === false && out.reason).not.toMatch(/sign in/i)
    expect(tradeFindMany).not.toHaveBeenCalled()
  })

  it("reads only the viewer's leagues", async () => {
    tradeFindMany.mockResolvedValue([trade('t1', 'L1')])
    leagueFindMany.mockResolvedValue([{ platformLeagueId: 'L1', name: 'My League' }])
    const { loadTrades } = await import('@/lib/core-app/playerCard')

    const out = await loadTrades('6813', { viewerLeagueIds: ['L1', 'L2'] })

    expect(tradeFindMany).toHaveBeenCalledTimes(1)
    const where = tradeFindMany.mock.calls[0][0].where
    expect(where.history).toEqual({ sleeperLeagueId: { in: ['L1', 'L2'] } })
    expect(out.available).toBe(true)
    expect(out.available && out.data.map((t) => t.leagueName)).toEqual(['My League'])
  })

  it('reads only the one league when the route has checked it', async () => {
    const { loadTrades } = await import('@/lib/core-app/playerCard')
    await loadTrades('6813', { leagueId: 'L9' })
    const where = tradeFindMany.mock.calls[0][0].where
    expect(where.history).toEqual({ sleeperLeagueId: 'L9' })
  })

  it('has no call site without a scope object', () => {
    const src = readFileSync(resolve(__dirname, '../lib/core-app/playerCard.ts'), 'utf8')
    const calls = [...src.matchAll(/loadTrades\(([^)]*)\)/g)]
      .map((m) => m[1])
      .filter((args) => !args.includes('TradeScope')) // the definition itself
    expect(calls.length).toBeGreaterThanOrEqual(2)
    for (const args of calls) expect(args, `loadTrades(${args}) must pass a scope object`).toMatch(/,\s*\{/)
    // The universal card resolves the viewer's own leagues first.
    expect(src).toMatch(/memberLeaguePlatformIdsFor\(req\.userId[^)]*\)[\s\S]{0,120}loadTrades\(player\.sleeperId, \{ viewerLeagueIds \}\)/)
  })
})

describe('memberLeaguePlatformIdsFor — the viewer set', () => {
  it('returns null for a signed-out viewer without querying', async () => {
    const { memberLeaguePlatformIdsFor } = await import('@/lib/league-access')
    expect(await memberLeaguePlatformIdsFor(null)).toBeNull()
    expect(await memberLeaguePlatformIdsFor(undefined)).toBeNull()
    expect(await memberLeaguePlatformIdsFor('')).toBeNull()
    expect(leagueFindMany).not.toHaveBeenCalled()
  })

  it('asks by all four membership paths and returns provider ids, de-duplicated', async () => {
    leagueFindMany.mockResolvedValue([
      { platformLeagueId: 'P1' },
      { platformLeagueId: 'P1' },
      { platformLeagueId: null },
      { platformLeagueId: 'P2' },
    ])
    const { memberLeaguePlatformIdsFor } = await import('@/lib/league-access')

    const out = await memberLeaguePlatformIdsFor('u1')

    expect(out).toEqual(['P1', 'P2'])
    const args = leagueFindMany.mock.calls[0][0]
    expect(args.where.OR).toEqual([
      { userId: 'u1' },
      { redraftMembers: { some: { userId: 'u1' } } },
      { rosters: { some: { platformUserId: 'u1' } } },
      { teams: { some: { claimedByUserId: 'u1' } } },
    ])
    expect(args.select).toEqual({ platformLeagueId: true })
  })

  it('mirrors the models resolveLeagueMembership checks (tripwire: update both together)', () => {
    const src = readFileSync(resolve(__dirname, '../lib/league-access.ts'), 'utf8')
    const start = src.indexOf('export async function resolveLeagueMembership')
    const end = src.indexOf('export async function memberLeaguePlatformIdsFor')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const models = new Set([...src.slice(start, end).matchAll(/prisma\.(\w+)\??\./g)].map((m) => m[1]))
    expect([...models].sort()).toEqual(['league', 'leagueTeam', 'redraftLeagueMember', 'roster'])
  })
})
