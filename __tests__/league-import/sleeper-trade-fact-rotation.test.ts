/**
 * The Sleeper trade-fact rotation (lib/league-import/sleeper/sleeperTradeFactRotation.ts) — the part of the
 * retired profile rotation that kept new Sleeper trades landing after import.
 *
 * Pinned: every league is reached in ceil(n / perTick) consecutive slots (nothing wedges the head), both
 * enrichment steps get the cap explicitly and the SAME leagues, the ingest is ONE batched call, and a failing
 * step is reported rather than thrown.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagues: [] as Array<{ id: string }>,
  findMany: vi.fn(),
  backfill: vi.fn(),
  ingest: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findMany: h.findMany } } }))
vi.mock('@/lib/psychological-profiles/TransactionFactBackfill', () => ({ backfillTransactionFactsFromTradeHistory: h.backfill }))
vi.mock('@/lib/psychological-profiles/SleeperTradeFactIngest', () => ({ ingestSleeperTradeFacts: h.ingest }))

import {
  rotateSleeperTradeFacts,
  rotationSlice,
  SLEEPER_TRADE_FACT_SLOT_MS,
} from '@/lib/league-import/sleeper/sleeperTradeFactRotation'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `L${String(i).padStart(3, '0')}`)

describe('rotationSlice', () => {
  it('covers every league in ceil(n / perTick) consecutive slots, whatever slot it starts on', () => {
    for (const [n, perTick, start] of [[50, 24, 0], [50, 24, 81_123], [7, 3, 5], [550, 24, 81_000]] as const) {
      const all = ids(n)
      const seen = new Set<string>()
      for (let s = start; s < start + Math.ceil(n / perTick); s++) rotationSlice(all, perTick, s).forEach((x) => seen.add(x))
      expect(seen.size).toBe(n)
    }
  })

  it('takes everything when the slice is at least the whole list, and nothing from an empty one', () => {
    expect(rotationSlice(ids(5), 24, 9)).toEqual(ids(5))
    expect(rotationSlice([], 24, 9)).toEqual([])
    expect(rotationSlice(ids(5), 0, 9)).toEqual([])
  })

  it('returns perTick distinct leagues when perTick < n', () => {
    const slice = rotationSlice(ids(50), 24, 3)
    expect(slice).toHaveLength(24)
    expect(new Set(slice).size).toBe(24)
  })
})

describe('rotateSleeperTradeFacts', () => {
  beforeEach(() => {
    h.leagues = ids(50).map((id) => ({ id }))
    h.findMany.mockReset().mockImplementation(async () => h.leagues)
    h.backfill.mockReset().mockResolvedValue({ factsWritten: 4 })
    h.ingest.mockReset().mockResolvedValue({ factsWritten: 9, rateLimited: 0 })
  })

  it('reads only Sleeper leagues, in a stable order', async () => {
    await rotateSleeperTradeFacts({ now: 0 })
    const arg = h.findMany.mock.calls[0]![0]
    expect(arg.where.platform).toEqual({ equals: 'sleeper', mode: 'insensitive' })
    expect(arg.orderBy).toEqual({ id: 'asc' })
  })

  it('gives both steps the SAME picked leagues with the cap passed explicitly, ingest batched once', async () => {
    const r = await rotateSleeperTradeFacts({ now: 3 * SLEEPER_TRADE_FACT_SLOT_MS })
    const picked = rotationSlice(ids(50), 24, 3)
    expect(h.backfill).toHaveBeenCalledWith({ leagueIds: picked, maxLeagues: 24 })
    expect(h.ingest).toHaveBeenCalledTimes(1)
    expect(h.ingest).toHaveBeenCalledWith({ leagueIds: picked, maxLeagues: 24 })
    expect(r).toMatchObject({ sleeperLeagues: 50, picked: 24, slot: 3, historyFactsWritten: 4, errors: [] })
  })

  it('moves to the next slice on the next slot', async () => {
    await rotateSleeperTradeFacts({ now: 3 * SLEEPER_TRADE_FACT_SLOT_MS })
    await rotateSleeperTradeFacts({ now: 4 * SLEEPER_TRADE_FACT_SLOT_MS })
    const [a, b] = h.ingest.mock.calls.map((c) => c[0].leagueIds as string[])
    expect(a).not.toEqual(b)
  })

  it('reports a failing step and still runs the other', async () => {
    h.backfill.mockRejectedValue(new Error('warehouse down'))
    const r = await rotateSleeperTradeFacts({ now: 0 })
    expect(h.ingest).toHaveBeenCalledTimes(1)
    expect(r.historyFactsWritten).toBeNull()
    expect(r.errors[0]).toMatch(/history backfill: warehouse down/)
  })

  it('does nothing without Sleeper leagues', async () => {
    h.leagues = []
    const r = await rotateSleeperTradeFacts({ now: 0 })
    expect(h.backfill).not.toHaveBeenCalled()
    expect(h.ingest).not.toHaveBeenCalled()
    expect(r.picked).toBe(0)
  })
})
