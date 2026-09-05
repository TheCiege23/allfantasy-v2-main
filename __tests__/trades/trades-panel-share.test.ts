import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  fetchTradesPanel,
  __resetTradesPanelShare,
} from '@/components/core-app/screens/tradesPanelFetch'

/**
 * 🛑 THE TRADE SCREEN READ THE SAME LEAGUE'S PANEL TWICE ON EVERY LOAD.
 *
 * `TradeInbox` reads the current league. `TradeLeagueStrip` reads a tile per league and does NOT
 * exclude the one already on screen. Measured in the dev server log, one page load:
 *
 *     GET /api/league/trades-panel?leagueId=2d2cc403…  200 in 16802ms
 *     GET /api/league/trades-panel?leagueId=2d2cc403…  200 in 17247ms   <- same league
 *     …the other eight leagues appear exactly once each
 *
 * That route runs `scanPendingSleeperTrades`, so the second read costs a full provider sweep on
 * a cache miss.
 *
 * ⚠ THIS IS NOT A STRICTMODE ARTIFACT. `reactStrictMode: true` doubles effects in dev and this
 * collapses those too, but the duplicate above comes from TWO COMPONENTS and survives into
 * production. The dev log's counts are not the production counts.
 */

let calls = 0

/*
 * ⚠ EVERY PENDING FETCH IS RESOLVABLE, NOT JUST THE LAST ONE. The first version of this fixture
 * kept a single resolver, so when a mutation disabled sharing the extra promise was never
 * resolved and the control failed by TIMING OUT at 30,020ms rather than asserting "expected 1,
 * got 2". Red-by-hang is weaker than red-for-the-reason, and a 30s wall is the CI flake shape
 * this same session already had to fix in the rotation suite.
 */
let resolvers: Array<() => void> = []
function flush() {
  const pending = resolvers
  resolvers = []
  for (const r of pending) r()
}

beforeEach(() => {
  calls = 0
  resolvers = []
  __resetTradesPanelShare()
  globalThis.fetch = vi.fn(() => {
    calls += 1
    return new Promise((res) => {
      resolvers.push(() =>
        res({
          ok: true,
          status: 200,
          json: async () => ({ pending: { scanned: true } }),
        } as Response),
      )
    })
  }) as unknown as typeof fetch
})

describe('🛑 two components, one request', () => {
  it('[control] a single caller does fetch — the dedup is not just swallowing everything', async () => {
    const p = fetchTradesPanel('L1')
    flush()
    await p
    expect(calls).toBe(1)
  })

  it('🛑 two callers for the SAME league share one in-flight request', async () => {
    const a = fetchTradesPanel('L1')
    const b = fetchTradesPanel('L1')
    flush()
    const [ra, rb] = await Promise.all([a, b])
    expect(calls).toBe(1)
    /* Both get the answer — sharing must not starve the second caller. */
    expect(ra.ok).toBe(true)
    expect(rb.ok).toBe(true)
    expect(rb.data).toEqual(ra.data)
  })

  it('⚠ DIFFERENT leagues are not shared — the strip must still read all eight', async () => {
    /*
     * The failure on the other side: a key too loose would collapse eight distinct leagues into
     * one answer, and every tile would show the same league's offers.
     */
    const a = fetchTradesPanel('L1')
    const b = fetchTradesPanel('L2')
    flush()
    await Promise.all([a, b])
    expect(calls).toBe(2)
  })

  it('⚠ force bypasses the window, so an explicit refresh still reaches the server', async () => {
    const a = fetchTradesPanel('L1')
    flush()
    await a
    const b = fetchTradesPanel('L1', { force: true })
    flush()
    await b
    expect(calls).toBe(2)
  })

  it('🛑 a failed read is EVICTED, not replayed for the whole window', async () => {
    /*
     * Caching a rejection would turn one refused request into a screen that cannot recover until
     * the window ages out. The next caller must get a real attempt.
     */
    globalThis.fetch = vi.fn(() => {
      calls += 1
      return Promise.reject(new Error('network'))
    }) as unknown as typeof fetch

    await expect(fetchTradesPanel('L1')).rejects.toThrow('network')
    await expect(fetchTradesPanel('L1')).rejects.toThrow('network')
    expect(calls).toBe(2)
  })
})

describe('🛑 both callers actually use it', () => {
  const INBOX = readFileSync(
    resolve(process.cwd(), 'components/core-app/screens/TradeInbox.tsx'),
    'utf8',
  )
  const STRIP = readFileSync(
    resolve(process.cwd(), 'components/core-app/screens/TradeLeagueStrip.tsx'),
    'utf8',
  )

  it('[control] the scans are reading the right files', () => {
    expect(INBOX).toContain('TradeInbox')
    expect(STRIP).toContain('TradeLeagueStrip')
  })

  it('🛑 neither still calls the endpoint directly on load', () => {
    /*
     * A shared helper nobody uses is the same defect as the roster list that rendered nothing:
     * correct code wired to nothing. This asserts the raw fetch is GONE from both load paths.
     */
    expect(INBOX).toContain('fetchTradesPanel(')
    expect(STRIP).toContain('fetchTradesPanel(')
    expect(INBOX).not.toMatch(/fetch\(`\/api\/league\/trades-panel/)
    expect(STRIP).not.toMatch(/fetch\(`\/api\/league\/trades-panel/)
  })
})
