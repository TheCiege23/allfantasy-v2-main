/**
 * The scheduled caller for the trade-offer ledger.
 *
 * The two assertions that carry real weight are the rotation LAP (a cursor that starves is
 * invisible — the sweep looks busy and simply never reaches the tail) and the feed-completeness
 * proof (a partial read must never be allowed to retire an offer).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  sleeperGet: vi.fn(),
  persist: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { league: { findMany: h.findMany } } }))
vi.mock('@/lib/trade-intel/sleeperTradeSync', () => ({ sleeperGet: h.sleeperGet }))
vi.mock('@/lib/provider-trades/providerTradeOfferLedger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/provider-trades/providerTradeOfferLedger')>()),
  persistProviderTradeOffers: h.persist,
}))

import {
  rotationWindow,
  sweepProviderTradeOffers,
  syncProviderTradeOffersForLeague,
} from '@/lib/provider-trades/syncProviderTradeOffers'

const SLOT = 30 * 60 * 1000

const TRADE = {
  transaction_id: 'tx1',
  type: 'trade',
  status: 'pending',
  roster_ids: [1, 2],
  adds: { '100': 1 },
  drops: { '100': 2 },
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findMany.mockResolvedValue([])
  h.sleeperGet.mockResolvedValue([])
  h.persist.mockResolvedValue({ offersWritten: 0, assetsWritten: 0, vanished: 0, vanishSkipped: false })
})

describe('rotationWindow', () => {
  const items = Array.from({ length: 50 }, (_, i) => `L${i}`)

  /**
   * 🛑 THE PROPERTY THAT MATTERS. The obvious cursor — least-recently-swept — starves: a league
   * that has never traded has no rows, reads as never-swept forever, and is picked every run while
   * the tail is never reached. The bug is invisible; the sweep looks busy and healthy.
   */
  it('covers every league exactly once per lap', () => {
    const limit = 15
    const seen = new Map<string, number>()
    const laps = Math.ceil(items.length / limit)
    for (let slot = 0; slot < laps; slot += 1) {
      for (const it of rotationWindow(items, limit, slot * SLOT)) {
        seen.set(it, (seen.get(it) ?? 0) + 1)
      }
    }
    // Every league reached; none skipped.
    expect(seen.size).toBe(items.length)
    expect([...seen.values()].every((n) => n >= 1)).toBe(true)
  })

  it('advances between consecutive slots rather than repeating a slice', () => {
    const a = rotationWindow(items, 15, 0)
    const b = rotationWindow(items, 15, SLOT)
    expect(a).not.toEqual(b)
    expect(a[0]).not.toBe(b[0])
  })

  it('is stable within one slot, so a retry sweeps the same slice', () => {
    expect(rotationWindow(items, 15, 5 * SLOT)).toEqual(rotationWindow(items, 15, 5 * SLOT + 60_000))
  })

  it('wraps rather than truncating at the end of the list', () => {
    const w = rotationWindow(items, 15, 3 * SLOT) // 45..59 -> wraps
    expect(w).toHaveLength(15)
    expect(new Set(w).size).toBe(15)
  })

  it('returns everything when the limit covers the list, and nothing on empty input', () => {
    expect(rotationWindow(items, 100, 0)).toHaveLength(50)
    expect(rotationWindow([], 15, 0)).toEqual([])
    expect(rotationWindow(items, 0, 0)).toEqual([])
  })
})

describe('syncProviderTradeOffersForLeague', () => {
  const base = { leagueId: 'lg1', sleeperLeagueId: 'S1', sport: 'NFL', season: 2026 }

  it('reads the whole feed and reports it complete', async () => {
    h.sleeperGet.mockResolvedValue([TRADE])
    const r = await syncProviderTradeOffersForLeague(base)
    expect(h.sleeperGet).toHaveBeenCalledTimes(18)
    expect(r.feedComplete).toBe(true)
    expect(h.persist.mock.calls[0][0].feedComplete).toBe(true)
  })

  /**
   * 🛑 ONE FAILED WEEK BREAKS THE PROOF. An offer missing from a feed we only partly read is not
   * evidence that it is gone — `sleeperGet` returns null for ANY failure, so a single null means
   * nothing may be retired this run.
   */
  it('refuses to claim a complete feed when a single week failed', async () => {
    let n = 0
    h.sleeperGet.mockImplementation(async () => (++n === 7 ? null : [TRADE]))
    const r = await syncProviderTradeOffersForLeague(base)
    expect(r.feedComplete).toBe(false)
    expect(h.persist.mock.calls[0][0].feedComplete).toBe(false)
  })

  it('reports an entirely dead feed as incomplete rather than as empty', async () => {
    h.sleeperGet.mockResolvedValue(null)
    const r = await syncProviderTradeOffersForLeague(base)
    expect(r.feedComplete).toBe(false)
    expect(r.offersSeen).toBe(0)
  })

  /** ⚠ An empty week is a real answer — it must NOT read as a failure. */
  it('treats an empty week as read, not as failed', async () => {
    h.sleeperGet.mockResolvedValue([])
    const r = await syncProviderTradeOffersForLeague(base)
    expect(r.feedComplete).toBe(true)
    expect(r.offersSeen).toBe(0)
  })

  it('stamps each offer with the week it was found in', async () => {
    h.sleeperGet.mockImplementation(async (path: string) =>
      path.endsWith('/13') ? [TRADE] : [],
    )
    await syncProviderTradeOffersForLeague(base)
    expect(h.persist.mock.calls[0][0].offers[0].weekOrPeriod).toBe(13)
  })

  /** ⚠ The buckets include completed and declined — a manager wants to see how it RESOLVED. */
  it('records settled trades too, not only unsettled ones', async () => {
    h.sleeperGet.mockImplementation(async (path: string) =>
      path.endsWith('/1')
        ? [{ ...TRADE, transaction_id: 'a', status: 'complete' },
           { ...TRADE, transaction_id: 'b', status: 'failed' }]
        : [],
    )
    await syncProviderTradeOffersForLeague(base)
    const statuses = h.persist.mock.calls[0][0].offers.map((o: { status: string }) => o.status)
    expect(new Set(statuses)).toEqual(new Set(['accepted', 'rejected']))
  })

  it('ignores non-trade transactions', async () => {
    h.sleeperGet.mockImplementation(async (path: string) =>
      path.endsWith('/1') ? [{ transaction_id: 'w', type: 'waiver', status: 'complete' }] : [],
    )
    const r = await syncProviderTradeOffersForLeague(base)
    expect(r.offersSeen).toBe(0)
  })

  it('returns the error instead of throwing when the write fails', async () => {
    h.persist.mockRejectedValue(new Error('P2021'))
    const r = await syncProviderTradeOffersForLeague(base)
    expect(r.error).toContain('P2021')
    expect(r.offersWritten).toBe(0)
  })
})

describe('sweepProviderTradeOffers', () => {
  const leagues = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `lg${String(i).padStart(2, '0')}`,
      platformLeagueId: `S${i}`,
      sport: 'NFL',
      season: 2026,
    }))

  it('sweeps only the rotation slice, not every league', async () => {
    h.findMany.mockResolvedValue(leagues(50))
    const r = await sweepProviderTradeOffers({ maxLeagues: 15, now: new Date(0) })
    expect(r.leaguesEligible).toBe(50)
    expect(r.leaguesSwept).toBe(15)
  })

  /**
   * ⚠ ORDERED BY id — A COLUMN THIS SWEEP NEVER WRITES. Ordering on anything it mutates
   * (`lastSeenAt`, say) reshuffles the list underneath the window every run and silently
   * reintroduces both starvation and double-coverage.
   */
  it('asks for a stable ordering', async () => {
    h.findMany.mockResolvedValue(leagues(3))
    await sweepProviderTradeOffers({ maxLeagues: 15 })
    expect(h.findMany.mock.calls[0][0].orderBy).toEqual({ id: 'asc' })
  })

  /** ⚠ One league's hiccup must not end the sweep, or the tail is never reached. */
  it('keeps going when one league fails', async () => {
    h.findMany.mockResolvedValue(leagues(3))
    let call = 0
    h.persist.mockImplementation(async () => {
      if (++call === 2) throw new Error('boom')
      return { offersWritten: 1, assetsWritten: 0, vanished: 0, vanishSkipped: false }
    })
    const r = await sweepProviderTradeOffers({ maxLeagues: 15 })
    expect(r.leaguesSwept).toBe(3)
    expect(r.results.filter((x) => x.error)).toHaveLength(1)
  })

  it('counts leagues whose feed was incomplete, so a partial run announces itself', async () => {
    h.findMany.mockResolvedValue(leagues(2))
    h.sleeperGet.mockResolvedValue(null)
    const r = await sweepProviderTradeOffers({ maxLeagues: 15 })
    expect(r.feedIncomplete).toBe(2)
  })

  it('degrades to an empty sweep when the league read fails', async () => {
    h.findMany.mockRejectedValue(new Error('db down'))
    const r = await sweepProviderTradeOffers({})
    expect(r.leaguesEligible).toBe(0)
    expect(r.leaguesSwept).toBe(0)
  })
})
