import { describe, expect, it } from 'vitest'

import { coverageReason, rosterIdCoverage, sampleRosterIds, USABLE_FRACTION } from '@/lib/core-app/rosterIdCoverage'

/*
 * "Can these rosters be searched by Sleeper id at all?"
 *
 * The ESPN importer's header records that ESPN rosters arrive as bare ESPN
 * ids. A Sleeper-id scan of them finds nobody, which reads as "unrostered" —
 * a claim. These pin the decision that stops that claim being made.
 */

describe('sampleRosterIds', () => {
  it('draws distinct ids across every roster array, as strings', () => {
    const ids = sampleRosterIds([
      { players: ['1', 2, '3'], starters: ['1'], reserve: [4], taxi: null },
      { players: ['3', '5'], starters: ['5'] },
    ])
    expect(ids.sort()).toEqual(['1', '2', '3', '4', '5'])
  })

  it('stops at the limit and ignores empties', () => {
    const ids = sampleRosterIds([{ players: ['', null, 'a', 'b', 'c', 'd'] }], 3)
    expect(ids).toHaveLength(3)
  })
})

describe('rosterIdCoverage', () => {
  it('a Sleeper league resolves and is usable', () => {
    const c = rosterIdCoverage(['1', '2', '3', '4'], new Set(['1', '2', '3', '4']))
    expect(c).toEqual({ sampled: 4, matched: 4, fraction: 1, usable: true })
  })

  it('an ESPN league resolves nothing and is NOT usable', () => {
    const c = rosterIdCoverage(['3139477', '4241457'], new Set(['10236']))
    expect(c.usable).toBe(false)
    expect(c.fraction).toBe(0)
  })

  it('a partial identity map above the threshold is still searchable', () => {
    const c = rosterIdCoverage(['1', '2', '3', 'x'], new Set(['1', '2', '3']))
    expect(c.fraction).toBeCloseTo(0.75, 5)
    expect(c.usable).toBe(true)
    expect(USABLE_FRACTION).toBeLessThanOrEqual(0.75)
  })

  /* Nothing sampled is nothing known — never "usable by default". */
  it('an empty sample is not usable', () => {
    expect(rosterIdCoverage([], new Set(['1'])).usable).toBe(false)
  })
})

describe('coverageReason', () => {
  it('names the platform the ids belong to', () => {
    expect(coverageReason('espn')).toMatch(/ESPN player ids/)
    expect(coverageReason('yahoo')).toMatch(/Yahoo player ids/)
    expect(coverageReason(null)).toMatch(/this platform/)
  })
})
