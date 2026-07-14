/**
 * Live-scoring worker loop — deterministic unit tests (G11 Phase 3c).
 * Pure: injected tick/sleep/stop — no daemon, no DB. Covers cadence→sleep
 * selection, overlap prevention, multi-tick looping, and graceful stop.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  resolveWorkerSleepMs,
  createOverlapGuard,
  runWorkerLoop,
  DEFAULT_WORKER_SLEEP,
  type WorkerTickResult,
} from '@/lib/live-scoring/workerLoop'

const OPTS = { minMs: 15_000, maxMs: 300_000, idleMs: 60_000 }

describe('resolveWorkerSleepMs', () => {
  it('clamps a live 30s cadence within bounds (stays 30s)', () => {
    expect(resolveWorkerSleepMs(30_000, OPTS)).toBe(30_000)
  })
  it('a cadence of 0 (nothing active) → idle re-check (not stop)', () => {
    expect(resolveWorkerSleepMs(0, OPTS)).toBe(60_000)
    expect(resolveWorkerSleepMs(-5, OPTS)).toBe(60_000)
  })
  it('floors a too-short cadence', () => {
    expect(resolveWorkerSleepMs(5_000, OPTS)).toBe(15_000)
  })
  it('caps a too-long cadence', () => {
    expect(resolveWorkerSleepMs(999_999, OPTS)).toBe(300_000)
  })
  it('has sane defaults', () => {
    expect(resolveWorkerSleepMs(30_000)).toBe(30_000)
    expect(resolveWorkerSleepMs(0)).toBe(DEFAULT_WORKER_SLEEP.idleMs)
  })
})

describe('createOverlapGuard — no overlapping ticks', () => {
  it('skips a second run while the first is in flight', async () => {
    const guard = createOverlapGuard()
    let release: () => void = () => {}
    const slow = guard.run(() => new Promise<number>((r) => { release = () => r(1) }))
    expect(guard.isRunning()).toBe(true)
    const second = await guard.run(async () => 2) // attempted during the first
    expect(second).toEqual({ skipped: true })
    release()
    expect(await slow).toEqual({ skipped: false, result: 1 })
    expect(guard.isRunning()).toBe(false)
  })

  it('runs again once the prior run completed', async () => {
    const guard = createOverlapGuard()
    expect(await guard.run(async () => 'a')).toEqual({ skipped: false, result: 'a' })
    expect(await guard.run(async () => 'b')).toEqual({ skipped: false, result: 'b' })
  })

  it('clears the running flag even if the fn throws', async () => {
    const guard = createOverlapGuard()
    await expect(guard.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(guard.isRunning()).toBe(false)
  })
})

describe('runWorkerLoop', () => {
  const tickResult = (ms: number): WorkerTickResult => ({ nextPollDelayMs: ms, polled: 1, ticked: 1 })

  it('ticks repeatedly and sleeps on the engine cadence until stopped', async () => {
    let done = 0
    const sleeps: number[] = []
    const { ticks } = await runWorkerLoop({
      tick: async () => { done += 1; return tickResult(30_000) },
      sleep: async (ms) => { sleeps.push(ms) },
      shouldStop: () => done >= 3, // stop after 3 ticks
      sleepOptions: OPTS,
    })
    expect(ticks).toBe(3)
    expect(sleeps.every((s) => s === 30_000)).toBe(true)
  })

  it('does not sleep after the final tick when stop is requested mid-loop', async () => {
    const sleeps: number[] = []
    let stop = false
    await runWorkerLoop({
      tick: async () => { stop = true; return tickResult(30_000) }, // request stop during the tick
      sleep: async (ms) => { sleeps.push(ms) },
      shouldStop: () => stop,
      sleepOptions: OPTS,
    })
    // shouldStop() is false at loop-top (first pass), tick sets stop=true, post-tick
    // check breaks before sleeping → exactly one tick, zero sleeps.
    expect(sleeps).toEqual([])
  })

  it('stops immediately if shouldStop is already true (graceful)', async () => {
    const tick = vi.fn(async () => tickResult(30_000))
    const { ticks } = await runWorkerLoop({ tick, sleep: async () => {}, shouldStop: () => true, sleepOptions: OPTS })
    expect(ticks).toBe(0)
    expect(tick).not.toHaveBeenCalled()
  })

  it('idles when the cadence is 0 (no active games)', async () => {
    let done = 0
    const sleeps: number[] = []
    await runWorkerLoop({
      tick: async () => { done += 1; return tickResult(0) },
      sleep: async (ms) => { sleeps.push(ms) },
      shouldStop: () => done >= 2,
      sleepOptions: OPTS,
    })
    expect(sleeps).toContain(60_000) // idleMs
  })
})
