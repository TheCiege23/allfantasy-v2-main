/**
 * Phase timer — attributes elapsed time to named stages of one request.
 *
 * Written because `/api/trade-value/analyze` has a p95 of 15–24s (measured from `ApiUsageRollup`,
 * ~50x this app's median endpoint) and NOTHING on that path says where the seconds go. Six
 * candidates were identified by reading the code; ranking them without measuring is how the last
 * two estimates in this workstream went wrong.
 */
import { describe, expect, it } from 'vitest'
import { createPhaseTimer, unattributedMs } from '@/lib/logging/phaseTimer'

/** Busy-wait, because a timer test that awaits a timeout measures the scheduler, not the timer. */
function burn(ms: number): void {
  const until = Date.now() + ms
  while (Date.now() < until) {
    /* spin */
  }
}

describe('createPhaseTimer', () => {
  it('attributes elapsed time to the phase named at the END of it', () => {
    const t = createPhaseTimer()
    burn(20)
    t.mark('first')
    burn(40)
    t.mark('second')
    const p = t.phases()
    expect(p.first).toBeGreaterThanOrEqual(15)
    expect(p.second).toBeGreaterThanOrEqual(35)
    // Disjoint: 'second' must not include the 20ms already charged to 'first'.
    expect(p.second).toBeGreaterThan(p.first!)
  })

  it('ACCUMULATES a repeated name rather than overwriting it', () => {
    /*
     * `resolveAssets` is called once per side, and the two calls are the same KIND of work. A timer
     * that overwrote would report only the second side and silently halve the number that matters.
     */
    const t = createPhaseTimer()
    burn(20)
    t.mark('assets')
    burn(5)
    t.mark('other')
    burn(20)
    t.mark('assets')
    const p = t.phases()
    expect(p.assets).toBeGreaterThanOrEqual(35)
    expect(p.other).toBeLessThan(p.assets!)
  })

  it('totalMs covers the whole run, including time never charged to a phase', () => {
    /*
     * ⚠ THE UNATTRIBUTED REMAINDER IS THE POINT. If the phases sum to far less than the total, the
     * instrumentation is missing the expensive step — which is exactly the failure this exists to
     * detect. Silently folding the gap into the last phase would hide it.
     */
    const t = createPhaseTimer()
    burn(20)
    t.mark('measured')
    burn(30) // never marked
    const p = t.phases()
    expect(t.totalMs()).toBeGreaterThanOrEqual(45)
    expect(p.measured).toBeLessThan(t.totalMs())
  })

  it('phases() returns a COPY, so a caller cannot corrupt the running tally', () => {
    const t = createPhaseTimer()
    t.mark('a')
    const snap = t.phases()
    snap.a = 999999
    expect(t.phases().a).not.toBe(999999)
  })

  it('is safe to use with no marks at all', () => {
    const t = createPhaseTimer()
    expect(t.phases()).toEqual({})
    expect(t.totalMs()).toBeGreaterThanOrEqual(0)
  })
})

describe('unattributedMs', () => {
  it('reports the remainder no phase claimed', () => {
    const t = createPhaseTimer()
    burn(15)
    t.mark('seen')
    burn(30) // unmarked
    expect(unattributedMs(t)).toBeGreaterThanOrEqual(20)
  })

  it('is zero, never negative, when every millisecond is accounted for', () => {
    /*
     * Rounding is per-mark, so a sum can exceed the total by a millisecond or two. A negative
     * remainder would be nonsense in telemetry and would read as "the phases over-explain the
     * request", so it clamps.
     */
    const t = createPhaseTimer()
    t.mark('a')
    t.mark('b')
    expect(unattributedMs(t)).toBeGreaterThanOrEqual(0)
  })
})

describe('runTradeConsoleAnalysis timer wiring', () => {
  it('takes the timer as an OPTIONAL second argument, so existing callers are unaffected', async () => {
    /*
     * The one thing that would break the rest of the app is making the timer required. This runs the
     * EMPTY-sides path, which returns before any await — so it pins the call shape without needing a
     * database, and the vitest DB guard stays satisfied.
     */
    const { runTradeConsoleAnalysis } = await import(
      '@/lib/trade-value-console/runTradeConsoleAnalysis'
    )
    const noTimer = await runTradeConsoleAnalysis({
      sportFilter: 'ALL',
      strategy: 'neutral',
      teamContext: 'neutral',
      sideGive: [],
      sideGet: [],
    } as never)
    expect(noTimer.ok).toBe(false)

    const t = createPhaseTimer()
    const withTimer = await runTradeConsoleAnalysis(
      {
        sportFilter: 'ALL',
        strategy: 'neutral',
        teamContext: 'neutral',
        sideGive: [],
        sideGet: [],
      } as never,
      { timer: t },
    )
    expect(withTimer.ok).toBe(false)
    // Returned before any instrumented stage, so nothing should have been charged.
    expect(t.phases()).toEqual({})
  })
})
