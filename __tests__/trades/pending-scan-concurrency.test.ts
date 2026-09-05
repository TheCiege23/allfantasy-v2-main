import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 THE 10-30 SECOND TRADE PAGE.
 *
 * `scanPendingSleeperTrades` fetched eighteen weeks in a strictly serial `for` loop, one HTTP
 * round trip each, and the cross-league strip fires EIGHT of those scans at once — so opening
 * /core/trades meant 144 provider calls, every league gated behind its own 18-deep chain.
 * Measured on the dev server: 5,015ms to 23,534ms per league, repeatedly, in one page load.
 *
 * ⚠ THE EXISTING SUITE PASSED BEFORE AND AFTER THE FIX, so it proves nothing about it. These
 * tests fail if the loop ever goes back to serial, and — more importantly — if the concurrent
 * version quietly reorders the inbox.
 */

const calls = vi.hoisted(() => ({ order: [] as number[], inFlight: 0, maxInFlight: 0 }))
const getLeagueTransactions = vi.hoisted(() => vi.fn())

vi.mock('server-only', () => ({}))
vi.mock('@/lib/api-cache/SleeperCacheLayer', () => ({
  getAllPlayers: vi.fn(async () => ({})),
  getLeagueRosters: vi.fn(async () => [{ roster_id: 1, owner_id: 'me', players: [] }]),
  getLeagueUsers: vi.fn(async () => [{ user_id: 'them', display_name: 'Them' }]),
  getLeagueTransactions,
}))

import { scanPendingSleeperTrades } from '@/lib/provider-trades/scanPendingSleeperTrades'

function trade(id: string, week: number) {
  return {
    transaction_id: id,
    type: 'trade',
    status: 'pending',
    roster_ids: [1, 2],
    creator: 'them',
    created: 1_700_000_000_000 + week,
    adds: {},
    drops: {},
    draft_picks: [],
    waiver_budget: [],
  }
}

const args = { platformLeagueId: 'L1', ownerSleeperId: 'me' }

beforeEach(() => {
  calls.order = []
  calls.inFlight = 0
  calls.maxInFlight = 0
  getLeagueTransactions.mockReset()
})

/** Each week resolves after a tick, so serial vs concurrent is observable. */
function slowWeeks(perWeekMs: number, body: (week: number) => unknown[] = () => []) {
  getLeagueTransactions.mockImplementation(async (_league: string, week: number) => {
    calls.inFlight += 1
    calls.maxInFlight = Math.max(calls.maxInFlight, calls.inFlight)
    await new Promise((r) => setTimeout(r, perWeekMs))
    calls.inFlight -= 1
    calls.order.push(week)
    return body(week)
  })
}

describe('🛑 the eighteen weeks are fetched concurrently, not one at a time', () => {
  it('[control] every week is actually requested', async () => {
    // Without this, "it was fast" could just mean it stopped scanning.
    slowWeeks(0)
    await scanPendingSleeperTrades(args)
    expect(getLeagueTransactions).toHaveBeenCalledTimes(18)
  })

  it('🛑 runs more than one week at a time — a serial loop can never exceed 1 in flight', async () => {
    /*
     * This is the assertion that fails if anyone restores `for (const week of weeks) { await ... }`.
     * It measures the EFFECT (overlap) rather than the shape of the code, so a refactor that keeps
     * the speed still passes.
     */
    slowWeeks(5)
    await scanPendingSleeperTrades(args)
    expect(calls.maxInFlight).toBeGreaterThan(1)
  })

  it('⚠ stays BOUNDED — unbounded would make one page load 144 simultaneous provider calls', async () => {
    /*
     * Eight leagues scan at once on the trade page. `Promise.all` over all eighteen weeks would
     * trade a latency bug for a rate-limit one against a third party.
     */
    slowWeeks(5)
    await scanPendingSleeperTrades(args)
    expect(calls.maxInFlight).toBeLessThanOrEqual(6)
  })

  it('finishes in far fewer waves than a serial scan would take', async () => {
    slowWeeks(10)
    const started = Date.now()
    await scanPendingSleeperTrades(args)
    const elapsed = Date.now() - started
    // Serial would be >= 18 * 10ms = 180ms. Three waves of six is ~30ms; allow generous slack.
    expect(elapsed).toBeLessThan(150)
  })
})

describe('🛑 concurrency must not reorder the inbox', () => {
  it('🛑 returns trades in WEEK order even when later weeks resolve first', async () => {
    /*
     * The whole risk of this change. Reading results in COMPLETION order would put whichever
     * request happened to return first at the top of a manager's offers. Week 1 is made slowest
     * here specifically so completion order and week order disagree.
     */
    getLeagueTransactions.mockImplementation(async (_l: string, week: number) => {
      await new Promise((r) => setTimeout(r, week === 1 ? 30 : 1))
      return [trade(`tx-w${week}`, week)]
    })
    const out = await scanPendingSleeperTrades(args)
    expect(out.trades.map((t) => t.transactionId).slice(0, 3)).toEqual(['tx-w1', 'tx-w2', 'tx-w3'])
  })

  it('dedupes on the EARLIEST week, the way the serial scan did', async () => {
    // The same offer can appear in more than one week's payload; the first occurrence wins.
    getLeagueTransactions.mockImplementation(async (_l: string, week: number) => {
      await new Promise((r) => setTimeout(r, week === 2 ? 0 : 20))
      return [trade('dupe', week)]
    })
    const out = await scanPendingSleeperTrades(args)
    expect(out.trades).toHaveLength(1)
  })
})

describe('⚠ a refusal is still not an empty week', () => {
  it('counts a throwing week as unanswered rather than as "no trades"', async () => {
    getLeagueTransactions.mockImplementation(async (_l: string, week: number) => {
      if (week === 3) throw new Error('sleeper refused')
      return []
    })
    const out = await scanPendingSleeperTrades(args)
    expect(out.weeksUnanswered).toBe(1)
    expect(out.scanned).toBe(true)
  })

  it('🛑 every week refusing means we know NOTHING, not that there are no offers', async () => {
    /*
     * The distinction the serial version was careful about, carried across the concurrent
     * boundary by `null` rather than by an early `continue`.
     */
    getLeagueTransactions.mockImplementation(async () => {
      throw new Error('sleeper down')
    })
    const out = await scanPendingSleeperTrades(args)
    expect(out.scanned).toBe(false)
    expect(out.trades).toEqual([])
    expect(out.reason).toBeTruthy()
  })

  it('a null body is an empty week, which is Sleeper spelling "quiet"', async () => {
    getLeagueTransactions.mockImplementation(async () => null)
    const out = await scanPendingSleeperTrades(args)
    expect(out.scanned).toBe(true)
    expect(out.weeksUnanswered).toBe(0)
    expect(out.trades).toEqual([])
  })
})
