import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 THE BUG THIS PINS: A BUDGET CHECKED *BEFORE* A CALL DOES NOT BOUND THE CALL.
 *
 * `/api/cron/import-schedules?riProfiles=1` already ran `createRunBudget()` (240s) and tested
 * `budget.exhausted()` before each sport AND again before the player sweep. It still died at the
 * platform edge. Measured from the slow-tier dispatcher log, 2026-09-06 09:20:37Z:
 *
 *     -> /api/cron/import-schedules?riProfiles=1 ... FAIL HTTP 502 (300049ms)
 *
 * With a second left on the budget the `exhausted()` test passes, and the sweep then loops once
 * per league — 30s a call for teams, 45s for players — with no ceiling of its own. SOCCER is
 * several leagues, so one sport is several minutes. `lib/cron/runBudget.ts` says it bounds the
 * NUMBER of units and not the duration of one; this is exactly that case.
 *
 * ⚠ SOCCER IS THE ONLY MULTI-LEAGUE SPORT (`leaguesFor`), which is why every test here uses it.
 * A single-league sport cannot exhibit the bug at all, so testing NFL would go green against the
 * unfixed code.
 */

const { riFetchRowsMock } = vi.hoisted(() => ({ riFetchRowsMock: vi.fn() }))

vi.mock('@/lib/workers/providers/rollingInsightsRest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workers/providers/rollingInsightsRest')>()
  return { ...actual, riFetchRows: riFetchRowsMock }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsTeam: { upsert: vi.fn().mockResolvedValue({}) },
    sportsPlayer: { upsert: vi.fn().mockResolvedValue({}) },
  },
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.resetModules()
})

/** No rows: this suite is about scheduling and bounding, not about parsing. */
function providerReturnsNothing() {
  riFetchRowsMock.mockResolvedValue({ rows: [], notModified: false, error: null })
}

describe('remainingFor — the clamp that turns the budget into a real ceiling', () => {
  it('is the cap when no deadline is supplied, so existing callers are unchanged', async () => {
    const { remainingFor } = await import('@/lib/cron/runBudget')
    expect(remainingFor(undefined, 30_000)).toBe(30_000)
  })

  it('clamps to the time REMAINING when that is less than the cap', async () => {
    const { remainingFor } = await import('@/lib/cron/runBudget')
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    // 5s left against a 30s cap — the request must not be allowed to run for 30s.
    expect(remainingFor(1_005_000, 30_000)).toBe(5_000)
  })

  it('stays at the cap when there is more time than the cap', async () => {
    const { remainingFor } = await import('@/lib/cron/runBudget')
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    expect(remainingFor(1_600_000, 30_000)).toBe(30_000)
  })

  /*
   * ⚠ NULL, NOT 0. A 0ms timeout is an immediately-aborted request, which surfaces as a provider
   * failure — a different and misleading claim from "we ran out of time". The 1s floor exists so
   * a request that cannot possibly complete is not started at all.
   */
  it('returns null rather than a zero timeout when time is gone', async () => {
    const { remainingFor } = await import('@/lib/cron/runBudget')
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    expect(remainingFor(999_000, 30_000)).toBeNull()
    expect(remainingFor(1_000_500, 30_000)).toBeNull()
  })
})

describe('a soccer sweep cannot outlast the budget it was given', () => {
  it('without a deadline every league is attempted — the default path is unchanged', async () => {
    providerReturnsNothing()
    const { syncRollingInsightsTeamsToDb } = await import('@/lib/sports-data/rollingInsightsTeamsPlayers')

    const res = await syncRollingInsightsTeamsToDb({ sport: 'SOCCER' })

    expect(res.deferredLeagues).toEqual([])
    expect(riFetchRowsMock.mock.calls.length).toBeGreaterThan(1) // proves soccer really fans out
  })

  it('a deadline already past attempts NOTHING and reports every league deferred', async () => {
    providerReturnsNothing()
    const { syncRollingInsightsTeamsToDb } = await import('@/lib/sports-data/rollingInsightsTeamsPlayers')
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)

    const res = await syncRollingInsightsTeamsToDb({ sport: 'SOCCER', deadlineAt: 999_000 })

    expect(riFetchRowsMock).not.toHaveBeenCalled()
    expect(res.deferredLeagues.length).toBeGreaterThan(1)
  })

  /*
   * The case that actually produced the 502: time runs out PART WAY through the league loop.
   * The clock is driven by the mock rather than by wall time, so this cannot flake.
   */
  it('stops mid-sweep when time runs out, and names the leagues it skipped', async () => {
    let clock = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    // Each provider call burns 20s of the remaining budget.
    riFetchRowsMock.mockImplementation(async () => {
      clock += 20_000
      return { rows: [], notModified: false, error: null }
    })
    const { syncRollingInsightsTeamsToDb } = await import('@/lib/sports-data/rollingInsightsTeamsPlayers')

    /*
     * 15s of headroom against a 20s call: the first league starts (time remained), overruns the
     * deadline, and every league after it is deferred. ⚠ A LOOSER DEADLINE DOES NOT MEAN FEWER
     * CALLS — with 30s the second league also starts, clamped to its remaining 10s. That is the
     * design working: a late call is bounded rather than forbidden, so it aborts instead of
     * running to the 30s cap.
     */
    const res = await syncRollingInsightsTeamsToDb({ sport: 'SOCCER', deadlineAt: clock + 15_000 })

    expect(riFetchRowsMock).toHaveBeenCalledTimes(1)
    expect(res.deferredLeagues.length).toBeGreaterThan(0)
    // Reported, not silently dropped — an omitted league reads as "the vendor had nothing".
    expect(res.byLeague[res.deferredLeagues[0]!]).toBeUndefined()
  })

  it('the player sweep is bounded the same way — it is the larger of the two', async () => {
    let clock = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    riFetchRowsMock.mockImplementation(async () => {
      clock += 20_000
      return { rows: [], notModified: false, error: null }
    })
    const { syncRollingInsightsPlayersToDb } = await import('@/lib/sports-data/rollingInsightsTeamsPlayers')

    const res = await syncRollingInsightsPlayersToDb({ sport: 'SOCCER', deadlineAt: clock + 15_000 })

    expect(riFetchRowsMock).toHaveBeenCalledTimes(1)
    expect(res.deferredLeagues.length).toBeGreaterThan(0)
  })

  /*
   * 🛑 THE LOAD-BEARING ASSERTION. Deferring is only half the fix: the request that DOES run must
   * also be clamped, or a call started with 5s left still runs for its full 30s cap and walks the
   * handler past the edge. This fails if `timeoutMs` is left at the constant.
   */
  it('clamps the request timeout to the time left, not the per-call cap', async () => {
    providerReturnsNothing()
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const { syncRollingInsightsTeamsToDb } = await import('@/lib/sports-data/rollingInsightsTeamsPlayers')

    await syncRollingInsightsTeamsToDb({ sport: 'SOCCER', deadlineAt: 1_004_000 }) // 4s left

    const passed = riFetchRowsMock.mock.calls[0]![1] as { timeoutMs?: number }
    expect(passed.timeoutMs).toBe(4_000)
    expect(passed.timeoutMs).toBeLessThan(30_000)
  })
})
