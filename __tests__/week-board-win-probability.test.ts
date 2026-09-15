// @vitest-environment node
/**
 * The week board's win-probability model, now shared with the pre-game odds snapshot
 * (2026-09-14): one formula, so the board and the snapshot cannot disagree.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { buildProfiles, pairRows, winProbabilityOf } from '@/lib/core-app/weekBoard'

describe('winProbabilityOf', () => {
  it('equal teams are a coin flip; the two sides always sum to 1; the better team is favoured', () => {
    expect(winProbabilityOf({ mu: 110, sigma: 12 }, { mu: 110, sigma: 20 })).toBeCloseTo(0.5, 6)
    const p = winProbabilityOf({ mu: 130, sigma: 15 }, { mu: 110, sigma: 12 })
    expect(p).toBeGreaterThan(0.5)
    expect(p + winProbabilityOf({ mu: 110, sigma: 12 }, { mu: 130, sigma: 15 })).toBeCloseTo(1, 6)
    // Φ(20 / √(15² + 12²)) = Φ(1.0412…) ≈ 0.8511
    expect(p).toBeCloseTo(0.8511, 3)
  })
})

describe('buildProfiles / pairRows (exported unchanged)', () => {
  const r = (rosterId: string, week: number, pointsFor: number, matchupId: number | null) => ({
    leagueId: 'L', seasonYear: 2026, week, rosterId, matchupId, pointsFor, pointsAgainst: pointsFor ? 1 : 0, win: 0,
  })

  it('profiles need three scored weeks and floor σ at 12; unscored rows do not count', () => {
    const profiles = buildProfiles([r('a', 1, 100, 1), r('a', 2, 101, 1), r('a', 3, 100, 1), r('a', 4, 0, 1), r('b', 1, 90, 1), r('b', 2, 91, 1)])
    expect(profiles.get('L:a')).toMatchObject({ n: 3, sigma: 12 })
    expect(profiles.get('L:a')!.mu).toBeCloseTo(100.33, 2)
    expect(profiles.has('L:b')).toBe(false)
  })

  it('pairs exactly two rows per matchup id; a null id or a group of one does not pair', () => {
    const pairs = pairRows([r('a', 1, 0, 7), r('b', 1, 0, 7), r('c', 1, 0, null), r('d', 1, 0, null), r('e', 1, 0, 9)])
    expect(pairs).toHaveLength(1)
    expect([pairs[0]!.a.rosterId, pairs[0]!.b.rosterId].sort()).toEqual(['a', 'b'])
  })
})
