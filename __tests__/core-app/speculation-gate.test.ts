import { describe, expect, it } from 'vitest'

import {
  createSpeculationGate,
  NAVIGATION_QUIET_MS,
  SPECULATION_SPACING_MS,
} from '@/components/core-app/speculationGate'

/**
 * The one gate every speculative /core render passes through. See `speculationGate.ts` for the
 * production trace that made it necessary: seven concurrent full renders from one page load.
 */
function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe('speculationGate', () => {
  it('lets the first speculative render through', () => {
    const c = clock()
    expect(createSpeculationGate(c.now).tryAcquire()).toBe(true)
  })

  it('🛑 refuses a second render inside the spacing — two warmers cannot start a burst together', () => {
    const c = clock()
    const gate = createSpeculationGate(c.now)
    expect(gate.tryAcquire()).toBe(true)
    c.advance(SPECULATION_SPACING_MS - 1)
    expect(gate.tryAcquire()).toBe(false)
    expect(gate.msUntilOpen()).toBe(1)
    c.advance(1)
    expect(gate.tryAcquire()).toBe(true)
  })

  it('a refused attempt does not reset the clock', () => {
    const c = clock()
    const gate = createSpeculationGate(c.now)
    gate.tryAcquire()
    c.advance(1_000)
    gate.tryAcquire() // refused
    c.advance(SPECULATION_SPACING_MS - 1_000)
    expect(gate.tryAcquire()).toBe(true)
  })

  it('🛑 stands down after a real navigation, even when no warm has run yet', () => {
    const c = clock()
    const gate = createSpeculationGate(c.now)
    gate.noteNavigation()
    expect(gate.tryAcquire()).toBe(false)
    c.advance(NAVIGATION_QUIET_MS - 1)
    expect(gate.tryAcquire()).toBe(false)
    c.advance(1)
    expect(gate.tryAcquire()).toBe(true)
  })

  it('a navigation extends the wait past a spacing that was about to open', () => {
    const c = clock()
    const gate = createSpeculationGate(c.now)
    gate.tryAcquire()
    c.advance(SPECULATION_SPACING_MS - 10)
    gate.noteNavigation()
    expect(gate.msUntilOpen()).toBe(NAVIGATION_QUIET_MS)
  })

  it('is open, with nothing to wait for, before anything has happened', () => {
    expect(createSpeculationGate(clock().now).msUntilOpen()).toBe(0)
  })
})
