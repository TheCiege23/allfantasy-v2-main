import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 `import-players` DIED AT THE PLATFORM EDGE ON EVERY RUN, AND THE PHASE THAT DID IT WAS THE
 * ONE ALREADY BEHIND A BUDGET GATE.
 *
 * The route checks `budget.exhausted()` before the identity phase — correct, and it bounds
 * nothing. Both `repairSleeperIds` and `backfillSleeperIds` then download Sleeper's entire player
 * universe, and neither fetch carried a signal. Measured from the slow-tier dispatcher log,
 * 2026-09-06 18:06:40Z:
 *
 *     -> /api/cron/import-players ... FAIL HTTP 502 (300037ms)
 *
 * The route ran on past the severed connection: every run in the preceding 48h took 378-582s and
 * recorded `success` in `sync_job_runs` — telemetry saying the job was fine for runs the caller
 * had already been told were 502s. Its death also delayed the next job in the same sequential
 * dispatch group (`import-news?xnews=1`) to 18:21.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    playerIdentityMap: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.resetModules()
})

/** Sleeper's universe, empty — this suite is about bounding, not about matching. */
function sleeperReturnsEmptyUniverse() {
  const spy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
  vi.stubGlobal('fetch', spy)
  return spy
}

describe('the identity phase cannot outrun the budget that gated it', () => {
  it('throws a DEFERRAL, not a failure, when there is no time left — and makes no request', async () => {
    const spy = sleeperReturnsEmptyUniverse()
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const { repairSleeperIds } = await import('@/lib/player-match/sleeperIdentitySync')

    await expect(repairSleeperIds({ sport: 'NFL', deadlineAt: 999_000 })).rejects.toMatchObject({
      name: 'SleeperIdentityBudgetExhausted',
    })
    expect(spy).not.toHaveBeenCalled()
  })

  it('the backfill defers the same way', async () => {
    const spy = sleeperReturnsEmptyUniverse()
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const { backfillSleeperIds } = await import('@/lib/player-match/sleeperIdentitySync')

    await expect(backfillSleeperIds({ sport: 'NFL', deadlineAt: 999_000 })).rejects.toMatchObject({
      name: 'SleeperIdentityBudgetExhausted',
    })
    expect(spy).not.toHaveBeenCalled()
  })

  /*
   * 🛑 THE LOAD-BEARING ASSERTION. Deferring when time is gone is the easy half; the request that
   * DOES run must also carry a ceiling, or a phase entered with a second left downloads a
   * multi-MB document with no bound — which is the actual 502. Goes red if `signal` is dropped.
   */
  it('every request carries an abort signal — the ceiling is wired, not just described', async () => {
    const spy = sleeperReturnsEmptyUniverse()
    const { repairSleeperIds } = await import('@/lib/player-match/sleeperIdentitySync')

    await repairSleeperIds({ sport: 'NFL', deadlineAt: Date.now() + 20_000 })

    const init = spy.mock.calls[0]?.[1] as { signal?: unknown } | undefined
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  /*
   * ⚠ THE DEFAULT PATH MUST BE UNCHANGED. `deadlineAt` is optional so the script and admin
   * callers keep working exactly as before — but "unbounded by default" would leave the bug in
   * place for anything that forgets, so the cap still applies and the signal is still attached.
   */
  it('without a deadline it still runs, and still carries a ceiling', async () => {
    const spy = sleeperReturnsEmptyUniverse()
    const { repairSleeperIds } = await import('@/lib/player-match/sleeperIdentitySync')

    await repairSleeperIds({ sport: 'NFL' })

    expect(spy).toHaveBeenCalledTimes(1)
    const init = spy.mock.calls[0]?.[1] as { signal?: unknown } | undefined
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })
})
