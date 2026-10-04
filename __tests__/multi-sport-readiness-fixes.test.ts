import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { normalizeNbaGameStats, aggregateWeeklyStats } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { resolveCategoryMatchup, accumulateTeamTotals } from '@/lib/category-scoring/CategoryMatchupResolver'
import { getCategoryPresetDefinitions } from '@/lib/category-scoring'
import { getLeagueDefaults } from '@/lib/league-defaults/getLeagueDefaults'
import { nativeCategoryScoringContext } from '@/lib/category-scoring/nativeCategoryScoringContext'
import { normalizeCfbdGameStats } from '@/lib/scoring-runtime/ncaafStatNormalization'
import { bridgeNcaafRosterIdsToCfbdIds } from '@/lib/redraft/ncaafGameLogIdBridge'
import { planNcaafFantraxIdentityLinks } from '@/lib/player-identity/ncaafFantraxIdentityPlan'

describe('multisport scoring readiness', () => {
  it('scores NBA categories from the actual short weekly keys with weighted percentages', () => {
    const a = aggregateWeeklyStats([{ points: 20, field_goals_made: 8, field_goals_attempted: 10, free_throws_made: 2, free_throws_attempted: 2 }, { points: 10, field_goals_made: 2, field_goals_attempted: 10, free_throws_made: 2, free_throws_attempted: 4 }], normalizeNbaGameStats).stats
    const result = resolveCategoryMatchup(accumulateTeamTotals([a]), { pts: 25, fgm: 6, fga: 10, ftm: 1, fta: 2 }, getCategoryPresetDefinitions('nba_9cat')!)
    expect(result.categories.find(c => c.label === 'PTS')).toMatchObject({ winner: 'a', aValue: 30 })
    expect(result.categories.find(c => c.label === 'FG%')).toMatchObject({ winner: 'b', aValue: .5 })
    expect(result.categories.find(c => c.label === 'FT%')?.aValue).toBeCloseTo(2/3)
  })
  it('creates NBA categories and preserves legacy stored 8-cat rules', () => {
    const d = getLeagueDefaults({ sport: 'NBA', format: 'redraft', draftType: 'snake', scoringPreset: 'nba_8cat' })
    expect(d.scoringSettings).toMatchObject({ scoringMode: 'h2h_category', categoryPresetId: 'nba_8cat_standard', categoryRecordMode: 'most' })
    expect(getCategoryPresetDefinitions('nba_8cat_standard')!.map(c => c.id)).not.toContain('nba_to')
    expect(getCategoryPresetDefinitions('nba_8cat')!.map(c => c.id)).toContain('nba_to')
    expect(() => getLeagueDefaults({ sport: 'NBA', format: 'best_ball', draftType: 'snake', scoringPreset: 'nba_8cat' })).toThrow()
  })
  it('grounds NBA OS/Chimmy context in the stored mode, never a different sport preset', () => {
    const settings = { scoring_mode: 'h2h_category', category_preset_id: 'nba_9cat', category_record_mode: 'most' }
    expect(nativeCategoryScoringContext(settings, 'NBA')?.categories).toHaveLength(9)
    expect(nativeCategoryScoringContext(settings, 'MLB')).toBeNull()
  })
  it('scores kicker makes without inventing field goal distance buckets', () => {
    const n = normalizeCfbdGameStats({ 'kicking.FGM': 3, 'kicking.FGA': 4, 'kicking.XPM': 2 })
    expect(n.stats).toEqual({ fg_made: 3, xp_made: 2, fg_miss: 1 })
    expect(n.unmappedKeys).toEqual([])
  })
  it('resolves a Fantrax roster only through explicit source provenance', async () => {
    const findMany = vi.fn(async ({ where }: any) => where.fantraxId ? [{ id: 'canonical', cfbdId: '42', fantraxId: 'opaque', rollingInsightsId: '99' }] : [])
    const b = await bridgeNcaafRosterIdsToCfbdIds({ sportsPlayer: { findMany: vi.fn() }, playerIdentityMap: { findMany } } as never, ['opaque', '99'], 'fantrax')
    expect(b.rosterIdFor('42')).toBe('opaque')
    expect(b.unresolved).toEqual(['99'])
    expect(findMany.mock.calls.some(([args]) => args.where.rollingInsightsId)).toBe(false)
  })
  it('links college imports conservatively and rejects school collisions and duplicate claims', () => {
    const row = { id: 'p1', canonicalName: 'John Smith', currentTeam: 'Vanderbilt University', position: 'QB', cfbdId: '42', fantraxId: null }
    const ref = { fantraxId: 'fx1', name: 'John Smith', team: 'Vanderbilt', position: 'QB' }
    expect(planNcaafFantraxIdentityLinks([ref], [row]).links).toHaveLength(1)
    expect(planNcaafFantraxIdentityLinks([ref, { ...ref, fantraxId: 'fx2' }], [row]).links).toEqual([])
    expect(planNcaafFantraxIdentityLinks([{ ...ref, team: 'University of Miami' }], [{ ...row, currentTeam: 'Miami University' }]).links).toEqual([])
  })
})

 it('maps captured college defensive fields without guessing assisted tackles or forced fumbles', () => {
  expect(normalizeCfbdGameStats({ 'defensive.SOLO': 3, 'defensive.TOT': 5, 'defensive.SACKS': 1.5, 'defensive.TFL': 2, 'defensive.PD': 1, 'interceptions.INT': 1 }).stats).toEqual({ idp_solo: 3, idp_tackle: 5, idp_sack: 1.5, idp_tfl: 2, idp_pd: 1, idp_int: 1 })
})
