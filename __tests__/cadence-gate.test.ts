import { describe, it, expect } from 'vitest'
import {
  createCadenceGate,
  LIVE_POLL_INTERVAL_MS,
  PBP_POLL_INTERVAL_MS,
  POLL_BUDGET_MS,
} from '@/lib/live/gamedayPoller'

/**
 * The gate is what stops the cheap endpoint's frequency from being applied to
 * the expensive one. `/live` is one call for the whole slate; `/play-by-play`
 * is one call per live game. Without this, a 13-game Sunday would issue 13
 * extra requests every tick.
 */
describe('createCadenceGate', () => {
  it('opens on the very first call, so a fresh invocation never skips plays', () => {
    let t = 1_000_000
    const gate = createCadenceGate(35_000, () => t)
    expect(gate()).toBe(true)
  })

  it('stays shut until the interval has actually elapsed', () => {
    let t = 0
    const gate = createCadenceGate(35_000, () => t)
    expect(gate()).toBe(true) // first

    t = 10_000; expect(gate()).toBe(false)
    t = 20_000; expect(gate()).toBe(false)
    t = 34_999; expect(gate()).toBe(false)
    t = 35_000; expect(gate()).toBe(true) // exactly due
    t = 40_000; expect(gate()).toBe(false) // clock restarts from the open
  })

  it('measures from the last OPEN, not from the last call', () => {
    let t = 0
    const gate = createCadenceGate(30_000, () => t)
    gate()                                   // opens at 0
    t = 29_000; expect(gate()).toBe(false)   // a closed call must not reset it
    t = 30_000; expect(gate()).toBe(true)    // still due at 30s from the open
  })

  it('opens once per interval across a full invocation at the live cadence', () => {
    // The real shape: the loop ticks at the live interval for one budget.
    let t = 0
    const gate = createCadenceGate(PBP_POLL_INTERVAL_MS, () => t)
    let opens = 0
    let ticks = 0
    for (; t <= POLL_BUDGET_MS; t += LIVE_POLL_INTERVAL_MS) {
      ticks += 1
      if (gate()) opens += 1
    }
    // Scores poll every tick; plays a fraction of that. The exact ratio is the
    // point — if these ever converge, the expensive endpoint is being spammed.
    expect(ticks).toBeGreaterThan(opens * 2)
    expect(opens).toBeGreaterThan(0)
  })
})

describe('cadence constants', () => {
  it('polls scores strictly more often than plays', () => {
    // The whole reason the gate exists. If someone equalises these, the cost
    // model changes silently and this fails.
    expect(LIVE_POLL_INTERVAL_MS).toBeLessThan(PBP_POLL_INTERVAL_MS)
  })

  it('respects the vendor floor of 5s between calls', () => {
    // Rolling Insights recommends at least 5s. Faster spends requests chasing
    // freshness their upstream has never been shown to have.
    expect(LIVE_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(5_000)
  })

  it('fits a full cycle inside the invocation budget', () => {
    // An invocation that overruns its budget overlaps the next cron firing.
    expect(LIVE_POLL_INTERVAL_MS).toBeLessThan(POLL_BUDGET_MS)
    expect(PBP_POLL_INTERVAL_MS).toBeLessThan(POLL_BUDGET_MS)
  })
})
