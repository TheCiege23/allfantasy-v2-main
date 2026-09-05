/**
 * The trade-notify sweep reaches every league, not the same 50 forever.
 *
 * 🛑 WHAT IT USED TO DO. `detectAndNotifyAll` ran `findMany({ take: 50 })` with no `orderBy` and no
 * cursor. That is not a sample of the leagues, it is the SAME 50 on every fire. Measured on
 * production 2026-09-05:
 *
 *     distinct Sleeper leagues        202
 *     leagues the sweep looked at      50
 *     never looked at                 152      (75%)
 *     selection order across calls    byte-identical
 *     runs recorded by the job      1,610      every one reporting `success`
 *
 * The job was healthy by every signal it emitted — it fired every 5 minutes, completed in 5-11
 * seconds and wrote a `success` row — while three quarters of the leagues had never once been
 * checked. Nothing about "read=50, written=0" looks wrong until you ask WHICH 50.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagueFindMany: vi.fn(),
  cacheFindUnique: vi.fn(),
  cacheUpsert: vi.fn(),
  currentIds: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: h.leagueFindMany },
    sportsDataCache: { findUnique: h.cacheFindUnique, upsert: h.cacheUpsert },
  },
}))
/*
 * ⚠ THE SLEEPER FEED IS STUBBED, AND NOT ONLY FOR SPEED. Unstubbed, each swept league fetches 18
 * transaction weeks, so five runs of fifty leagues attempted ~4,500 requests and the suite took 13
 * seconds while depending on how fast the network refuses. What is under test here is WHICH
 * leagues get picked, which is decided before any of that.
 */
vi.mock('@/lib/trade-intel/sleeperTradeSync', async (importOriginal) => {
  /*
   * ⚠ PARTIAL, NOT A REPLACEMENT. A whole-module mock dropped `sleeperGet`, which
   * `sleeperTradeGradeService` imports at module scope — the suite then failed to LOAD rather than
   * failing an assertion, which looks nothing like the bug it was meant to catch.
   */
  const actual = await importOriginal<typeof import('@/lib/trade-intel/sleeperTradeSync')>()
  return { ...actual, currentCompletedTradeIds: h.currentIds }
})

import { detectAndNotifyAll } from '@/lib/trade-intel/tradeNotifyService'

/** 202 leagues, ids ordered so a keyset walk is observable. */
const ALL = Array.from({ length: 202 }, (_, i) => ({ platformLeagueId: String(1000 + i) }))

function pageFor(from: string, take: number) {
  return ALL.filter((l) => l.platformLeagueId > from).slice(0, take)
}

beforeEach(() => {
  vi.resetAllMocks()
  h.cacheFindUnique.mockResolvedValue(null)
  h.cacheUpsert.mockResolvedValue({})
  // Feed unavailable: the sweep records that and moves on, which is all this file needs.
  h.currentIds.mockResolvedValue(null)
  // The service calls detectAndNotifyLeague internally; the network side of that is not under test
  // here, so the league query is what this file drives and asserts.
  h.leagueFindMany.mockImplementation(async (args: Record<string, unknown>) => {
    const where = args.where as { platformLeagueId?: { gt?: string } }
    const from = where?.platformLeagueId?.gt ?? ''
    return pageFor(String(from), Number(args.take ?? 50))
  })
})

describe('🛑 the sweep rotates instead of re-reading the same page', () => {
  it('orders by platformLeagueId, so the page is deterministic rather than incidental', async () => {
    await detectAndNotifyAll(50)
    const args = h.leagueFindMany.mock.calls[0][0]
    expect(args.orderBy).toEqual({ platformLeagueId: 'asc' })
  })

  it('🛑 asks for ids AFTER the cursor, not an offset', async () => {
    /*
     * Keyset, not `skip`. An offset drifts when a league is added or removed mid-cycle: the rows
     * shift underneath it and one is silently skipped. `gt` cannot skip a row, only revisit one.
     */
    h.cacheFindUnique.mockResolvedValue({ data: { after: '1049' } })
    await detectAndNotifyAll(50)
    const args = h.leagueFindMany.mock.calls[0][0] as { where: Record<string, unknown>; skip?: unknown }
    expect((args.where.platformLeagueId as { gt?: string }).gt).toBe('1049')
    expect(args.skip).toBeUndefined()
  })

  it('🛑 advances the cursor to the last id of the page', async () => {
    await detectAndNotifyAll(50)
    const written = h.cacheUpsert.mock.calls.at(-1)![0]
    expect(written.update.data).toEqual({ after: '1049' })
  })

  it('🛑 five runs reach ALL 202 leagues — the whole point', async () => {
    /*
     * The regression this file exists for. Before the fix this loop visits 50 distinct leagues no
     * matter how many times it runs.
     */
    let cursor = ''
    const seen = new Set<string>()
    for (let run = 0; run < 5; run++) {
      h.cacheFindUnique.mockResolvedValue({ data: { after: cursor } })
      h.cacheUpsert.mockClear()
      await detectAndNotifyAll(50)
      for (const c of h.leagueFindMany.mock.results) {
        for (const l of (await c.value) as Array<{ platformLeagueId: string }>) seen.add(l.platformLeagueId)
      }
      cursor = h.cacheUpsert.mock.calls.at(-1)![0].update.data.after
    }
    expect(seen.size).toBe(202)
  })

  it('resets at the tail so the next run wraps to the start', async () => {
    // A page shorter than the limit is the end of the list.
    h.cacheFindUnique.mockResolvedValue({ data: { after: '1199' } })
    await detectAndNotifyAll(50)
    expect(h.cacheUpsert.mock.calls.at(-1)![0].update.data).toEqual({ after: '' })
  })

  it('🛑 the page size is unchanged, because this job already runs near its timeout', async () => {
    /*
     * `scripts/cron-fast-tier-loop.mjs` records p99 359s against a 300s maxDuration. Covering all
     * 202 in one fire would trade a coverage bug for a timeout; rotation keeps each run the size it
     * is today.
     */
    await detectAndNotifyAll()
    expect(h.leagueFindMany.mock.calls[0][0].take).toBe(50)
  })
})
