/** Chimmy's dynasty context (lib/dynasty-core/dynastyContextForChimmy.ts) says when pick trades close. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ enforcement: vi.fn(), prisma: { league: { findUnique: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/taxi/taxiRulesService', () => ({ loadTaxiEnforcement: m.enforcement }))
vi.mock('@/lib/dynasty-core/DynastySettingsService', () => ({
  getEffectiveDynastySettings: vi.fn(async () => ({
    rosterFormatType: 'sf', scoringPresetName: 'PPR', playoffTeamCount: 6, regularSeasonWeeks: 14,
    rookieDraftRounds: 4, rookieDraftType: 'linear', rookiePickOrderMethod: 'max_pf', useMaxPfForNonPlayoff: true,
  })),
}))
vi.mock('@/lib/taxi/TaxiSettingsService', () => ({
  getEffectiveTaxiSettings: vi.fn(async () => ({ taxiSlotCount: 3, taxiEligibilityYears: 1, taxiLockBehavior: 'once_promoted_no_return', taxiScoringOn: false })),
}))

import { buildDynastyContextForChimmy } from '@/lib/dynasty-core/dynastyContextForChimmy'

describe('Chimmy and the pick trade deadline', () => {
  beforeEach(() => m.enforcement.mockResolvedValue(null))
  const ctx = async (settings: unknown) => {
    m.prisma.league.findUnique.mockResolvedValue({ isDynasty: true, leagueVariant: null, tradeDeadlineWeek: 11, settings })
    return buildDynastyContextForChimmy('L', 'u')
  }
  it('the default: pick trades close with the trade deadline', async () => {
    expect(await ctx(null)).toContain('Pick trades close with the trade deadline, like player trades.')
  })
  it('open all season, or closed after its own week, each enforced', async () => {
    expect(await ctx({ pick_trade_deadline: { mode: 'open' } })).toContain('a trade made only of draft picks stays open all season, after the trade deadline too; a trade with any player or FAAB closes at the trade deadline (enforced).')
    expect(await ctx({ pick_trade_deadline: { mode: 'week', week: 16 } })).toContain('a trade made only of draft picks closes after week 16, whatever the trade deadline; a trade with any player or FAAB follows the trade deadline (week 11) (enforced).')
  })
})
