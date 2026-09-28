import { describe, expect, it } from 'vitest'
import { HEALTHY_STATES, leagueCoverageVerdict } from '../scripts/cron-freshness-check.mjs'

/**
 * The game-day league-coverage probe. Measured 2026-09-28 (#1453): 313 of 315 leagues inside the
 * hour, the other two deleted at Sleeper — and the probe stayed red all day because it counted the
 * deleted ones as stale. These pin both halves: a tracked deletion is not staleness, and a
 * reachable league that goes stale still fails, however many deletions ride alongside it.
 */
describe('leagueCoverageVerdict', () => {
  it('passes when the only stale leagues are deleted at the provider and still re-checked', () => {
    const v = leagueCoverageVerdict({ gameDay: true, connected: 315, stale: 2, trackedGone: 2 })
    expect(v.state).toBe('OK')
    expect(v.reachableStale).toBe(0)
    expect(HEALTHY_STATES.has(v.state)).toBe(true)
  })

  it('still fails on ONE reachable stale league, deletions notwithstanding', () => {
    const v = leagueCoverageVerdict({ gameDay: true, connected: 315, stale: 3, trackedGone: 2 })
    expect(v.state).toBe('STALE')
    expect(v.reachableStale).toBe(1)
  })

  it('fails when a deleted league is no longer being re-checked (not counted as tracked)', () => {
    // The SQL only counts a gone league as tracked while its daily re-check is inside 26h.
    expect(leagueCoverageVerdict({ gameDay: true, connected: 315, stale: 2, trackedGone: 0 }).state).toBe('STALE')
  })

  it('fails on a wave of "deleted" leagues, which is a misclassification, not a cleanup', () => {
    const ceiling = leagueCoverageVerdict({ gameDay: true, connected: 315, stale: 0, trackedGone: 0 }).goneCeiling
    expect(ceiling).toBe(7)
    expect(leagueCoverageVerdict({ gameDay: true, connected: 315, stale: ceiling, trackedGone: ceiling }).state).toBe('OK')
    expect(
      leagueCoverageVerdict({ gameDay: true, connected: 315, stale: ceiling + 1, trackedGone: ceiling + 1 }).state,
    ).toBe('STALE')
    // A small portfolio still tolerates a couple of genuine deletions.
    expect(leagueCoverageVerdict({ gameDay: true, connected: 20, stale: 3, trackedGone: 3 }).state).toBe('OK')
  })

  it('keeps the off-day and empty verdicts it had before', () => {
    expect(leagueCoverageVerdict({ gameDay: false, connected: 315, stale: 300, trackedGone: 0 }).state).toBe('IDLE')
    expect(leagueCoverageVerdict({ gameDay: true, connected: 0, stale: 0, trackedGone: 0 }).state).toBe('EMPTY')
  })
})
