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
 *
 * The file has since grown past concurrency — it also pins what the scan REPORTS: `scanned`,
 * `weeksUnanswered`, and the `unscannedKind` split that decides whether /core treats a failure
 * as permanent. Renamed from `pending-scan-concurrency` to match.
 */

const calls = vi.hoisted(() => ({ order: [] as number[], inFlight: 0, maxInFlight: 0 }))
const getLeagueTransactions = vi.hoisted(() => vi.fn())
// Hoisted so a test can make the ROSTERS read fail — the path that misclassified an outage.
const getLeagueRosters = vi.hoisted(() => vi.fn())

vi.mock('server-only', () => ({}))
/*
 * ⚠ PARTIAL MOCK, so `SleeperHttpError` is the REAL class. The scan does `err instanceof
 * SleeperHttpError` to tell a permanent 404 from a transient 429, and a duplicate class declared
 * in this factory would be a different identity — the check would silently never match, which is
 * the failure the error type exists to prevent.
 */
vi.mock('@/lib/api-cache/SleeperCacheLayer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-cache/SleeperCacheLayer')>()),
  getAllPlayers: vi.fn(async () => ({})),
  getLeagueRosters,
  getLeagueUsers: vi.fn(async () => [{ user_id: 'them', display_name: 'Them' }]),
  getLeagueTransactions,
}))

import { SleeperHttpError } from '@/lib/api-cache/SleeperCacheLayer'
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
  getLeagueRosters.mockReset()
  getLeagueRosters.mockResolvedValue([{ roster_id: 1, owner_id: 'me', players: [] }])
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

  /*
   * 🛑 `scanned: false` COVERS TWO UNRELATED SITUATIONS AND A CALLER CANNOT TELL THEM APART.
   *
   * Sleeper being down is transient — retry and it may work. "No roster here is yours" is
   * permanent: same input, same answer, for the life of the league. /core's "since your last
   * visit" holds its trade window open while a read is incomplete, so treating the permanent one
   * as a failure holds that window open forever, re-reporting the same trades on every visit with
   * nothing able to clear it. `unscannedKind` is what lets the caller separate them.
   */
  describe('unscannedKind', () => {
    it('marks a provider outage transient', async () => {
      getLeagueTransactions.mockImplementation(async () => {
        throw new Error('sleeper down')
      })
      expect((await scanPendingSleeperTrades(args)).unscannedKind).toBe('provider')
    })

    it('marks "no roster of yours in this league" permanent', async () => {
      const out = await scanPendingSleeperTrades({ ...args, ownerSleeperId: 'nobody' })
      expect(out.scanned).toBe(false)
      expect(out.unscannedKind).toBe('identity')
    })

    it('marks a missing Sleeper identity permanent', async () => {
      expect((await scanPendingSleeperTrades({ ...args, ownerSleeperId: '' })).unscannedKind).toBe('identity')
    })

    /*
     * 🛑 THE CASE THAT LET A BLOCKER SHIP GREEN. The rosters read used to be `.catch(() => [])`,
     * so "Sleeper refused the rosters call" and "you own no roster here" were the SAME value at
     * the lookup — and once the caller began treating the second as permanent, an outage was
     * classified permanent too and /core closed its trade window over a league it never read.
     * Every test in this file mocked that call to SUCCEED, so nothing could see it.
     */
    it('marks a rosters-read failure transient, not permanent', async () => {
      getLeagueRosters.mockRejectedValue(new SleeperHttpError(429, '/league/L1/rosters'))
      const out = await scanPendingSleeperTrades(args)
      expect(out.scanned).toBe(false)
      expect(out.unscannedKind).toBe('provider')
      /*
       * ⚠ AND THE REASON, WHICH IS WHAT SEPARATES THIS FROM THE CASE BELOW. Two guards cover the
       * classification — not catching the rosters read, and refusing to read identity out of an
       * empty list — and the second alone makes `unscannedKind` right either way. Measured:
       * restoring the `.catch(() => [])` leaves a kind-only assertion green. Only the reason
       * distinguishes "the call failed" from "the call returned nothing".
       */
      expect(out.reason).toBe('Sleeper could not be reached')
    })

    /* An empty-but-successful list is not evidence about whose rosters these are either. */
    it('marks an empty rosters list transient', async () => {
      getLeagueRosters.mockResolvedValue([])
      const out = await scanPendingSleeperTrades(args)
      expect(out.unscannedKind).toBe('provider')
      expect(out.reason).toBe('Sleeper returned no rosters for this league')
    })

    /*
     * 🛑 A 404 IS NOT UNAVAILABILITY. A league deleted on Sleeper, or a shadow/mis-import, answers
     * 404 on every render for the life of the row. Classified `provider` it would hold /core's
     * trade boundary open forever — the harm the provider/identity split exists to prevent,
     * reached from the other side.
     */
    it.each([
      ['404, a league that is gone', 404, 'identity'],
      ['410, also gone', 410, 'identity'],
      ['429, a rate limit', 429, 'provider'],
      ['500, a provider fault', 500, 'provider'],
      ['503, a provider fault', 503, 'provider'],
      /*
       * 🛑 THE ROWS THAT KEEP THE CUT NARROW. A first version classified every 4xx but 429 as
       * permanent. Sleeper v1 is public and unauthenticated, so a 401/403 is an edge block and
       * 408/425 are transient — and `reason` is rendered verbatim to the manager, so a wrong
       * permanent verdict tells someone their league is gone when it is not.
       */
      ['401, an edge block', 401, 'provider'],
      ['403, an edge block', 403, 'provider'],
      ['408, a timeout', 408, 'provider'],
      ['425, too early', 425, 'provider'],
      ['400, a malformed request', 400, 'provider'],
    ])('classifies %s', async (_label, status, kind) => {
      getLeagueRosters.mockRejectedValue(new SleeperHttpError(status as number, '/league/L1/rosters'))
      const out = await scanPendingSleeperTrades(args)
      expect(out.unscannedKind).toBe(kind)
      // The copy travels with the verdict — TradeInbox renders `reason` verbatim.
      expect(out.reason).toBe(
        kind === 'identity' ? 'this league no longer exists on Sleeper' : 'Sleeper could not be reached',
      )
    })

    /* An error that is not a SleeperHttpError says nothing about permanence — treat it as transient. */
    it('treats an untyped throw as transient', async () => {
      getLeagueRosters.mockRejectedValue(new Error('socket hang up'))
      expect((await scanPendingSleeperTrades(args)).unscannedKind).toBe('provider')
    })

    it('leaves it null on a scan that answered', async () => {
      getLeagueTransactions.mockImplementation(async () => [])
      const out = await scanPendingSleeperTrades(args)
      expect(out.scanned).toBe(true)
      expect(out.unscannedKind).toBeNull()
    })
  })
})
