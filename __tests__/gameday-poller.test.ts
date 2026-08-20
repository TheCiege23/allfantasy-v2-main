import { describe, it, expect } from 'vitest'
import { runPollLoop, LIVE_POLL_INTERVAL_MS, POLL_BUDGET_MS } from '@/lib/live/gamedayPoller'

/**
 * The loop is pure given an injected clock and sleep, so the thing actually
 * worth testing — that an invocation never overruns into the next one — can be
 * asserted without waiting 105 real seconds.
 */

/** A fake clock that only advances when the loop "sleeps". */
function harness(opts: { active: boolean | (() => boolean); tickThrows?: boolean }) {
  let t = 0
  const slept: number[] = []
  let tickCount = 0
  return {
    slept,
    get tickCount() { return tickCount },
    get elapsed() { return t },
    run: () =>
      runPollLoop(
        async () => {
          tickCount++
          if (opts.tickThrows) throw new Error('provider blip')
        },
        {
          isActive: async () =>
            typeof opts.active === 'function' ? opts.active() : opts.active,
          now: () => t,
          sleepFn: async (ms) => { slept.push(ms); t += ms },
        },
      ),
  }
}

describe('runPollLoop — budget and overlap', () => {
  it('never exceeds the budget, so invocation N ends before N+1 starts', () => {
    // 105s budget, 35s interval: the guard needs interval + 5s of headroom to
    // sleep again, so it stops rather than running past the cron window.
    const h = harness({ active: true })
    return h.run().then((r) => {
      expect(r.elapsedMs).toBeLessThan(POLL_BUDGET_MS)
      expect(r.stoppedBecause).toBe('budget')
      // Each sleep is exactly the live cadence.
      expect(h.slept.every((ms) => ms === LIVE_POLL_INTERVAL_MS)).toBe(true)
    })
  })

  it('gives roughly the documented 35s cadence across the window', async () => {
    const h = harness({ active: true })
    const r = await h.run()
    // 105s / 35s leaves room for 3 ticks (2 sleeps) before the headroom guard.
    expect(r.ticks).toBeGreaterThanOrEqual(3)
    expect(h.slept.length).toBe(r.ticks - 1)
  })
})

describe('runPollLoop — self-gating', () => {
  it('still ticks once when nothing is live, so it is never worse than a single-tick cron', async () => {
    const h = harness({ active: false })
    const r = await h.run()
    expect(r.ticks).toBe(1)
    expect(r.stoppedBecause).toBe('no-active-games')
    expect(h.slept).toHaveLength(0)
    expect(r.elapsedMs).toBe(0)
  })

  it('stops as soon as the last game finishes mid-window', async () => {
    let calls = 0
    // Live for the first two checks, then everything goes final.
    const h = harness({ active: () => ++calls <= 2 })
    const r = await h.run()
    expect(r.ticks).toBe(3)
    expect(h.slept).toHaveLength(2)
  })
})

describe('runPollLoop — a bad tick must not cost the window', () => {
  it('keeps polling after a throwing tick and reports it', async () => {
    const h = harness({ active: true, tickThrows: true })
    const r = await h.run()
    // A provider blip on tick 1 must not forfeit the remaining ~70 seconds.
    expect(r.ticks).toBeGreaterThanOrEqual(3)
    expect(r.stoppedBecause).toBe('error')
  })
})
