/**
 * Chimmy's dynasty context (lib/dynasty-core/dynastyContextForChimmy.ts) carries the taxi move rules
 * when they are enforced, and says nothing about them otherwise.
 */
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

describe('Chimmy and the taxi rules', () => {
  beforeEach(() => m.prisma.league.findUnique.mockResolvedValue({ isDynasty: true, leagueVariant: null }))
  it('enforced: the rules, in words', async () => {
    m.enforcement.mockResolvedValue({ rules: { lockAfterWeek: 6, promotionDeadlineWeek: null, lockBehavior: 'free_move', inSeasonMoves: true, postseasonMoves: true }, season: null })
    expect(await buildDynastyContextForChimmy('L', 'u')).toContain('Taxi squad rules (enforced on every lineup save): no player goes onto the taxi squad after week 6.')
  })
  it('not enforced, or the read failed: nothing about them', async () => {
    m.enforcement.mockResolvedValue(null)
    expect(await buildDynastyContextForChimmy('L', 'u')).not.toContain('enforced on every lineup save')
    m.enforcement.mockRejectedValue(new Error('db'))
    expect(await buildDynastyContextForChimmy('L', 'u')).not.toContain('enforced on every lineup save')
  })
})
