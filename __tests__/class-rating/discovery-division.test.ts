// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { isCardInViewerRange } from '@/lib/public-discovery/PublicDiscoveryService'
import type { ManagerClass } from '@/lib/class-rating/reads'

const est = (division: number): ManagerClass => ({
  status: 'established', rating: 1500, rd: 60, games: 50, classLevel: division * 5, division, percentile: 0.5, computedAt: 'x',
})
const ctx = (viewerClass: ManagerClass, divisions: Array<[string, number | null]>, viewerTier = 1, leagueTier = 1) => ({
  viewerTier,
  leagueTier,
  viewerClass,
  fantasyDivisions: new Map(divisions),
})

describe('isCardInViewerRange — discovery shows a fantasy league exactly when an open join would pass', () => {
  it('🛑 hides an out-of-band fantasy league from an established viewer, shows an in-band one', () => {
    expect(isCardInViewerRange({ source: 'fantasy', id: 'far' }, ctx(est(1), [['far', 4]]))).toBe(false)
    expect(isCardInViewerRange({ source: 'fantasy', id: 'near' }, ctx(est(3), [['near', 4]]))).toBe(true)
  })

  it('shows every fantasy league to an unrated or provisional viewer, and an unrated league to everyone', () => {
    expect(isCardInViewerRange({ source: 'fantasy', id: 'far' }, ctx({ status: 'unrated' }, [['far', 5]]))).toBe(true)
    expect(isCardInViewerRange({ source: 'fantasy', id: 'new' }, ctx(est(1), [['new', null]]))).toBe(true)
    expect(isCardInViewerRange({ source: 'fantasy', id: 'unknown' }, ctx(est(1), []))).toBe(true)
  })

  it('🛑 XP tier no longer decides a fantasy card — but still decides bracket and creator cards', () => {
    // Career tiers 1 vs 9 are far outside the old ±1 window; divisions 3 vs 3 are in band.
    expect(isCardInViewerRange({ source: 'fantasy', id: 'L' }, ctx(est(3), [['L', 3]], 1, 9))).toBe(true)
    expect(isCardInViewerRange({ source: 'bracket', id: 'B' }, ctx(est(3), [], 1, 9))).toBe(false)
    expect(isCardInViewerRange({ source: 'creator', id: 'C' }, ctx(est(3), [], 1, 2))).toBe(true)
  })
})
