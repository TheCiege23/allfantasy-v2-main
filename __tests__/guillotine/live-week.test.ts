/** @vitest-environment node */
/**
 * 🛑 AFTER THE FIRST CHOP EVERY MEMBER WATCHED LAST WEEK, ALL SEASON. The summary opened on the latest
 * SCORED week, and a week is scored only when it is chopped, so the live chop line worked in week 1 only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ latest: null as { weekOrPeriod: number } | null, season: null as { status: string } | null }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    guillotinePeriodScore: { findFirst: vi.fn(async () => h.latest) },
    guillotineSeason: { findFirst: vi.fn(async () => h.season) },
  },
}))
vi.mock('@/lib/team-coowners/access', () => ({ acceptedCoOwnerRosterId: vi.fn(async () => null) }))

import { guillotineLiveWeek, resolveGuillotineCurrentWeek, resolveGuillotineLiveWeek } from '@/lib/guillotine/guillotineCurrentWeek'

describe('guillotineLiveWeek', () => {
  it('before any chop it is the first chop week', () => {
    expect(guillotineLiveWeek({ latestScored: null, startWeek: 1 })).toBe(1)
    expect(guillotineLiveWeek({ latestScored: null, startWeek: 6 })).toBe(6)
    expect(guillotineLiveWeek({ latestScored: null })).toBe(1)
  })
  it('🛑 once a week is chopped, the week being played is the next one', () => {
    expect(guillotineLiveWeek({ latestScored: 1, startWeek: 1, endWeek: 17 })).toBe(2)
    expect(guillotineLiveWeek({ latestScored: 9, startWeek: 1, endWeek: 17 })).toBe(10)
  })
  it('[control] it stays on the last week when nothing comes after it', () => {
    expect(guillotineLiveWeek({ latestScored: 17, startWeek: 1, endWeek: 17 })).toBe(17)
    expect(guillotineLiveWeek({ latestScored: 8, startWeek: 1, endWeek: 17, seasonComplete: true })).toBe(8)
  })
})

describe('resolveGuillotineLiveWeek', () => {
  beforeEach(() => { h.latest = null; h.season = null })
  it('reads the last settled week and steps past it', async () => {
    h.latest = { weekOrPeriod: 4 }
    h.season = { status: 'active' }
    expect(await resolveGuillotineLiveWeek('L', { eliminationStartWeek: 1, eliminationEndWeek: 17 })).toBe(5)
    // The older resolver still names the last settled week, for the surfaces that want that.
    expect(await resolveGuillotineCurrentWeek('L', { eliminationStartWeek: 1 })).toBe(4)
  })
  it('a finished season stays on its last week', async () => {
    h.latest = { weekOrPeriod: 12 }
    h.season = { status: 'complete' }
    expect(await resolveGuillotineLiveWeek('L', { eliminationStartWeek: 1, eliminationEndWeek: 17 })).toBe(12)
  })
})
