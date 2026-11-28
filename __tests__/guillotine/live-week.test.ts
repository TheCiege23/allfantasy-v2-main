/** @vitest-environment node */
/**
 * 🛑 AFTER THE FIRST CHOP EVERY MEMBER WATCHED LAST WEEK, ALL SEASON. The summary opened on the latest
 * SCORED week, and a week is scored only when it is chopped, so the live chop line worked in week 1 only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ latest: null as { weekOrPeriod: number } | null, season: null as { status: string } | null, settings: null as Record<string, unknown> | null }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    guillotinePeriodScore: { findFirst: vi.fn(async () => h.latest) },
    guillotineSeason: { findFirst: vi.fn(async () => h.season) },
    league: { findUnique: vi.fn(async () => (h.settings ? { settings: h.settings } : null)) },
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
  it('🛑 two-week periods: the week being played is the period’s key week, the one that chops', () => {
    // Weeks 1–2, 3–4, 5–6 … keyed 2, 4, 6. Before any chop: 2. After the week-2 chop: 4, all through weeks 3 and 4.
    expect(guillotineLiveWeek({ latestScored: null, startWeek: 1, endWeek: 18, periodWeeks: 2 })).toBe(2)
    expect(guillotineLiveWeek({ latestScored: 2, startWeek: 1, endWeek: 18, periodWeeks: 2 })).toBe(4)
    // [control] the same input without periodWeeks is the old one-week answer.
    expect(guillotineLiveWeek({ latestScored: 2, startWeek: 1, endWeek: 18 })).toBe(3)
    // A league starting week 3 pairs 3–4, 5–6.
    expect(guillotineLiveWeek({ latestScored: 4, startWeek: 3, endWeek: 18, periodWeeks: 2 })).toBe(6)
  })
  it('[control] it stays on the last week when nothing comes after it', () => {
    expect(guillotineLiveWeek({ latestScored: 17, startWeek: 1, endWeek: 17 })).toBe(17)
    expect(guillotineLiveWeek({ latestScored: 8, startWeek: 1, endWeek: 17, seasonComplete: true })).toBe(8)
  })
})

describe('resolveGuillotineLiveWeek', () => {
  beforeEach(() => { h.latest = null; h.season = null; h.settings = null })
  it('reads the league’s period length: a two-week league after the week-2 chop is on week 4', async () => {
    h.latest = { weekOrPeriod: 2 }
    h.season = { status: 'active' }
    h.settings = { guillotine_period_weeks: 2 }
    expect(await resolveGuillotineLiveWeek('L', { eliminationStartWeek: 1, eliminationEndWeek: 18 })).toBe(4)
  })
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
