/**
 * Contract tests for `respondBeforeEdge` — the hard ceiling on a cron handler's RESPONSE.
 *
 * Context: three jobs 502'd at ~300s on 2026-09-07 while all three already held a 240s
 * `createRunBudget()`. The budget is checked BETWEEN units, so a unit starting at 239s runs
 * unbounded. This guard bounds the response instead, so the caller gets a recorded partial result
 * rather than a severed connection.
 *
 * The properties pinned here are the ones that would silently invert the guard's meaning:
 *   1. a legitimate `undefined` result is NOT read as a timeout — the sentinel must be identity-safe
 *   2. rejections still propagate, so a real failure is never disguised as a deferral
 *   3. `onOverrun` is not called when the work finished, so nothing is reported deferred that ran
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { respondBeforeEdge, CRON_HARD_RESPONSE_MS } from '@/lib/cron/runBudget'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('respondBeforeEdge', () => {
  it('returns the work’s own result when it finishes in time', async () => {
    const onOverrun = vi.fn(() => 'partial')
    const r = await respondBeforeEdge(async () => 'done', onOverrun, 5_000)

    expect(r).toEqual({ result: 'done', overran: false })
    // Nothing may be reported as deferred when the work actually completed.
    expect(onOverrun).not.toHaveBeenCalled()
  })

  it('returns the partial response when the work is still running at the deadline', async () => {
    vi.useFakeTimers()
    const onOverrun = vi.fn(() => 'partial')
    // Never settles — stands in for a unit awaiting a provider that will not answer.
    const p = respondBeforeEdge<string>(() => new Promise<string>(() => {}), onOverrun, 1_000)

    await vi.advanceTimersByTimeAsync(1_000)

    await expect(p).resolves.toEqual({ result: 'partial', overran: true })
    expect(onOverrun).toHaveBeenCalledTimes(1)
  })

  it('🛑 does NOT treat a legitimate undefined result as a timeout', async () => {
    // The whole reason the sentinel is a Symbol. With `undefined` as the sentinel this returns
    // {result: 'partial', overran: true} and reports completed work as deferred.
    const onOverrun = vi.fn(() => 'partial' as unknown as undefined)
    const r = await respondBeforeEdge<undefined>(async () => undefined, onOverrun, 5_000)

    expect(r.overran).toBe(false)
    expect(r.result).toBeUndefined()
    expect(onOverrun).not.toHaveBeenCalled()
  })

  it('🛑 does NOT treat a legitimate null result as a timeout either', async () => {
    const onOverrun = vi.fn(() => 'partial' as unknown as null)
    const r = await respondBeforeEdge<null>(async () => null, onOverrun, 5_000)

    expect(r.overran).toBe(false)
    expect(r.result).toBeNull()
    expect(onOverrun).not.toHaveBeenCalled()
  })

  it('propagates a rejection rather than disguising a failure as a deferral', async () => {
    const onOverrun = vi.fn(() => 'partial')

    await expect(
      respondBeforeEdge(async () => {
        throw new Error('provider exploded')
      }, onOverrun, 5_000),
    ).rejects.toThrow('provider exploded')

    // A thrown job is a FAILED job. Reporting it as deferred would make a broken cron look healthy,
    // which is the false-clean signal this whole area exists to remove.
    expect(onOverrun).not.toHaveBeenCalled()
  })

  it('leaves no pending timer once the work has finished', async () => {
    vi.useFakeTimers()
    const before = vi.getTimerCount()

    await respondBeforeEdge(async () => 'done', () => 'partial', 60_000)

    // Cleared in `finally`; one leaked timer per fire adds up in a long-lived server process.
    expect(vi.getTimerCount()).toBe(before)
  })

  it('defaults to 270s, leaving 30s of headroom under the 300s platform edge', () => {
    expect(CRON_HARD_RESPONSE_MS).toBe(270_000)
    // The edge is 300s and is not ours to move; see the header in lib/cron/runBudget.ts.
    expect(CRON_HARD_RESPONSE_MS).toBeLessThan(300_000)
  })
})
