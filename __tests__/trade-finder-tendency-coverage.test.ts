import { describe, it, expect } from 'vitest'
import { resolveTendencyCoverage } from '@/lib/trade-finder/tendencyCoverage'

/**
 * The distinction under test: a partner list ranked on roster overlap alone and one
 * ranked on the full five-dimension model look identical to a caller. Four of those
 * dimensions come from TradePreAnalysisCache, which held ONE row across all of
 * production because its only two writers live inside app/af-legacy.
 */
describe('tendency coverage: a thin ranking must not read as a full one', () => {
  it('reports ready once any manager has tendencies', () => {
    const c = resolveTendencyCoverage({ managersWithTendencies: 8, managersEvaluated: 12, warmStarted: false })
    expect(c.state).toBe('ready')
    expect(c.detail).toContain('manager tendencies')
  })

  it('reports warming when the cache was cold and a run was started', () => {
    const c = resolveTendencyCoverage({ managersWithTendencies: 0, managersEvaluated: 12, warmStarted: true })
    expect(c.state).toBe('warming')
    expect(c.detail).toContain('roster fit only')
    expect(c.detail).toContain('Re-run')
  })

  it('reports unavailable when cold and nothing was started', () => {
    const c = resolveTendencyCoverage({ managersWithTendencies: 0, managersEvaluated: 12, warmStarted: false })
    expect(c.state).toBe('unavailable')
    expect(c.detail).toContain('roster fit only')
  })

  it('a lookup failure outranks everything else — it is not silently a cold cache', () => {
    const c = resolveTendencyCoverage({
      managersWithTendencies: 5, managersEvaluated: 12, warmStarted: true, lookupFailed: true,
    })
    expect(c.state).toBe('unavailable')
    expect(c.detail).toContain('could not be loaded')
  })

  it('always carries the counts, so partial coverage is visible rather than binary', () => {
    const c = resolveTendencyCoverage({ managersWithTendencies: 3, managersEvaluated: 18, warmStarted: false })
    expect(c.managersWithTendencies).toBe(3)
    expect(c.managersEvaluated).toBe(18)
    // 3 of 18 still says "ready" -- the counts are what expose how thin it is.
    expect(c.state).toBe('ready')
  })

  it('never claims tendencies when none were found', () => {
    for (const warmStarted of [true, false]) {
      const c = resolveTendencyCoverage({ managersWithTendencies: 0, managersEvaluated: 10, warmStarted })
      expect(c.state).not.toBe('ready')
      expect(c.detail).toContain('roster fit only')
    }
  })
})
