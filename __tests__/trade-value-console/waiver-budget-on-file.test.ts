/**
 * The waiver budget the trade grader prices budget moves against (`waiverBudgetOnFile`, `loadLeagueForTrade`).
 *
 * 🛑 `League.waiverBudget` DEFAULTS TO 100. A Fantrax league — whose import never records a budget — graded a $5,000
 * budget move against $100 (2026-11-18). A stored 100 on such a platform is the column default and must read as
 * unknown, so the grader withholds the budget ("not graded") instead of grading it confidently and wrongly.
 */
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ findFirst: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findFirst: h.findFirst } } }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: async () => ({ ok: true }) }))

import { loadLeagueForTrade, waiverBudgetOnFile, WAIVER_BUDGET_SET_KEY } from '@/lib/trade-value-console/league-loader'

describe('waiverBudgetOnFile', () => {
  it('🛑 a Fantrax or Yahoo league at the column default of 100 is unknown, not a $100 budget', () => {
    for (const platform of ['fantrax', 'Fantrax', 'yahoo']) {
      expect(waiverBudgetOnFile({ platform, waiverBudget: 100, settings: {} }), platform).toBeNull()
    }
  })

  it('a budget a commissioner saved stands, even when it is exactly 100', () => {
    expect(waiverBudgetOnFile({ platform: 'fantrax', waiverBudget: 100, settings: { [WAIVER_BUDGET_SET_KEY]: '2026-11-19T00:00:00.000Z' } })).toBe(100)
  })

  it('any other value was put there on purpose and stands — the 99,000 a commissioner set by hand', () => {
    expect(waiverBudgetOnFile({ platform: 'fantrax', waiverBudget: 99000, settings: null })).toBe(99000)
  })

  it('platforms whose import writes the budget they report keep 100: it is a common real budget there', () => {
    for (const platform of ['sleeper', 'espn', 'mfl', 'fleaflicker', 'allfantasy', null]) {
      expect(waiverBudgetOnFile({ platform, waiverBudget: 100, settings: {} }), String(platform)).toBe(100)
    }
  })

  it('no budget, zero or a non-number is unknown', () => {
    for (const waiverBudget of [null, 0, -5, Number.NaN]) {
      expect(waiverBudgetOnFile({ platform: 'sleeper', waiverBudget, settings: {} })).toBeNull()
    }
  })
})

describe('loadLeagueForTrade', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 'lg', platformLeagueId: 'x', platform: 'fantrax', name: 'L', sport: 'NFL', leagueSize: 12, isDynasty: false,
    leagueType: 'redraft', scoring: null, settings: {}, waiverBudget: 100, taxiSlots: 0, leagueVariant: null,
    bestBallMode: false, starters: null, season: 2026, status: null, ...over,
  })

  it('hands the grader null for a Fantrax default, and the real number once it is set', async () => {
    h.findFirst.mockResolvedValueOnce(row({}))
    expect((await loadLeagueForTrade({ leagueId: 'lg', userId: 'u', membershipPreverified: true }))?.waiverBudget).toBeNull()
    h.findFirst.mockResolvedValueOnce(row({ waiverBudget: 99000 }))
    expect((await loadLeagueForTrade({ leagueId: 'lg', userId: 'u', membershipPreverified: true }))?.waiverBudget).toBe(99000)
  })
})
