import { describe, it, expect, vi } from 'vitest'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'

/**
 * Chimmy's pending-trade inbox, 2026-11-20: one league world per build, each evaluation its own copy.
 * The inbox grades up to three offers in a row and re-resolved the same world for every one.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const { oneWorldPerBatch } = await import('@/lib/decision-os/trade/sharedWorld')
const { buildPendingTradeDecisionContext } = await import('@/lib/chimmy-trade/pendingTradeDecisionGrounding')

const world = () =>
  ({
    league: { leagueId: 'L1', season: 2026, lastSyncedAt: new Date('2026-11-20T12:00:00.000Z') },
    teams: [{ teamId: 't1', source: { sourceTeamId: 'x1' } }],
    rosters: [{ rosterId: 'r1', teamId: 't1', playerIds: ['p1', 'p2'] }],
    provenance: {},
    completeness: {},
  }) as unknown as CanonicalWorld

describe('oneWorldPerBatch', () => {
  it('loads the league once for the whole batch', async () => {
    const load = vi.fn(async () => world())
    const get = oneWorldPerBatch(load)
    await get('L1')
    await get('L1')
    await get('L1')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('🛑 hands every evaluation its OWN copy, so one offer can never change another’s input', async () => {
    const get = oneWorldPerBatch(async () => world())
    const a = (await get('L1'))!
    a.rosters[0].playerIds.push('traded-away')
    ;(a.league as { season: number }).season = 1999
    const b = (await get('L1'))!
    expect(b).not.toBe(a)
    expect(b.rosters[0].playerIds).toEqual(['p1', 'p2'])
    expect(b.league.season).toBe(2026)
  })

  it('the copy is the world the evaluation would have loaded — Dates stay Dates', async () => {
    const get = oneWorldPerBatch(async () => world())
    const copy = (await get('L1'))!
    expect(copy).toEqual(world())
    expect((copy.league as { lastSyncedAt: Date }).lastSyncedAt).toBeInstanceOf(Date)
  })

  it('a miss is never shared: null and a throw are both retried by the next evaluation', async () => {
    const load = vi
      .fn<(id: string) => Promise<CanonicalWorld | null>>()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(world())
    const get = oneWorldPerBatch(load)
    expect(await get('L1')).toBeNull()
    expect(await get('L1')).toBeNull()
    expect(await get('L1')).toEqual(world())
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('a different league is a different load', async () => {
    const load = vi.fn(async () => world())
    const get = oneWorldPerBatch(load)
    await get('L1')
    await get('L2')
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('the pending-trade inbox shares one world across the offers it grades', () => {
  const offers = ['t1', 't2', 't3'].map((tradeId) => ({ ref: { kind: 'af' as const, tradeId }, from: 'Rival FC', expiresAt: null }))

  async function run() {
    const resolveWorld = vi.fn(async () => world())
    const seen: unknown[] = []
    const evaluate = vi.fn(async (args: { leagueId: string }, deps?: { resolveWorld?: (id: string) => Promise<unknown> }) => {
      // What evaluateStoredTrade does first: resolve the league's world through the deps it was given.
      seen.push(await deps!.resolveWorld!(args.leagueId))
      return { ok: false as const, refusal: { reason: 'test refusal.' } }
    })
    const out = await buildPendingTradeDecisionContext('L1', 'user-1', {
      findProposals: async () => [],
      findStoredOffers: async () => offers,
      evaluate: evaluate as never,
      resolveWorld,
    })
    return { out, resolveWorld, evaluate, seen }
  }

  it('three offers graded, one world load', async () => {
    const { resolveWorld, evaluate, seen } = await run()
    expect(evaluate).toHaveBeenCalledTimes(3)
    expect(resolveWorld).toHaveBeenCalledTimes(1)
    expect(resolveWorld).toHaveBeenCalledWith('L1')
    // Each evaluation saw the league's world, each as its own object.
    for (const w of seen) expect(w).toEqual(world())
    expect(new Set(seen).size).toBe(3)
  })

  it('the inbox text is unchanged by the sharing', async () => {
    const { out } = await run()
    expect(out).toContain('PENDING INCOMING TRADES (3)')
    expect(out?.match(/Grade: NOT AVAILABLE — test refusal\./g)).toHaveLength(3)
  })
})
