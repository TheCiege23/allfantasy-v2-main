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
  // Real labels from the 2026-11-19 Fantrax CFB capture: same player, same school, different label.
  it('matches college defenders by position group (CB/DB, OLB/LB, DE/EDGE, DL/DE)', () => {
    const row = { id: 'p1', canonicalName: 'Josiah Brown', currentTeam: 'Vanderbilt University', position: 'DB', cfbdId: '42', fantraxId: null }
    const ref = { fantraxId: 'fx1', name: 'Brown, Josiah', team: 'Vanderbilt', position: 'CB' }
    for (const [fantrax, registry] of [['CB', 'DB'], ['S', 'DB'], ['OLB', 'LB'], ['DE', 'EDGE'], ['DL', 'DE'], ['EDGE', 'LB']]) {
      expect(planNcaafFantraxIdentityLinks([{ ...ref, position: fantrax }], [{ ...row, position: registry }]).links, `${fantrax}/${registry}`).toHaveLength(1)
    }
  })
  it('still refuses a same-named player in another position group', () => {
    const row = { id: 'p1', canonicalName: 'John Smith', currentTeam: 'Vanderbilt University', position: 'WR', cfbdId: '42', fantraxId: null }
    for (const fantrax of ['RB', 'DB', 'LB', 'QB']) {
      expect(planNcaafFantraxIdentityLinks([{ fantraxId: 'fx1', name: 'Smith, John', team: 'Vanderbilt', position: fantrax }], [row]).links, fantrax).toEqual([])
    }
    expect(planNcaafFantraxIdentityLinks([{ fantraxId: 'fx1', name: 'Smith, John', team: 'Vanderbilt', position: 'DE' }], [{ ...row, position: 'OLB' }]).links).toEqual([])
  })

  /*
   * 2026-11-19: 366 rostered Fantrax ids had one same-name identity and it was Rolling Insights-only (no
   * CFBD id), each backed by an RI row agreeing on name, school and position (Dwight Johnson, OL, Vanderbilt
   * stands in for Lamar's here — the schools resolve the same way).
   */
  describe('RI-only identities', () => {
    const riRow = { id: 'r1', canonicalName: 'Dwight Johnson', currentTeam: 'Vanderbilt University', position: 'OL', cfbdId: null, fantraxId: null, rollingInsightsId: '9001' }
    const ref = { fantraxId: '06974', name: 'Johnson, Dwight', team: 'Vanderbilt', position: 'OL' }
    const proof = new Map([['9001', { name: 'Dwight Johnson', team: 'Vanderbilt University', position: 'OL' }]])

    it('links one, keyed by RI id, when its RI row agrees', () => {
      const plan = planNcaafFantraxIdentityLinks([ref], [riRow], [], {}, proof)
      expect(plan.riLinks).toEqual([{ id: 'r1', fantraxId: '06974', rollingInsightsId: '9001' }])
      expect(plan.links).toEqual([])
    })
    it('refuses without an RI row, or when the RI row disagrees on name, school or position', () => {
      expect(planNcaafFantraxIdentityLinks([ref], [riRow], [], {}, new Map()).riLinks).toEqual([])
      for (const bad of [{ name: 'Dwayne Johnson' }, { team: 'University of Miami' }, { position: 'WR' }]) {
        const disagree = new Map([['9001', { ...proof.get('9001')!, ...bad }]])
        expect(planNcaafFantraxIdentityLinks([ref], [riRow], [], {}, disagree).riLinks, JSON.stringify(bad)).toEqual([])
      }
    })
    it('never prefers it over a CFBD-backed identity of the same name and school', () => {
      const cfbd = { ...riRow, id: 'c1', cfbdId: '42', rollingInsightsId: null }
      const plan = planNcaafFantraxIdentityLinks([ref], [riRow, cfbd], [], {}, proof)
      expect(plan.links).toEqual([{ id: 'c1', fantraxId: '06974', cfbdId: '42' }])
      expect(plan.riLinks).toEqual([])
    })
    it('refuses two agreeing RI-only identities, and changes nothing when no proof is passed', () => {
      const twin = { ...riRow, id: 'r2', rollingInsightsId: '9002' }
      const both = new Map([...proof, ['9002', proof.get('9001')!]])
      expect(planNcaafFantraxIdentityLinks([ref], [riRow, twin], [], {}, both).riLinks).toEqual([])
      expect(planNcaafFantraxIdentityLinks([ref], [riRow]).riLinks).toEqual([])
    })
  })
})

 it('maps captured college defensive fields without guessing assisted tackles or forced fumbles', () => {
  expect(normalizeCfbdGameStats({ 'defensive.SOLO': 3, 'defensive.TOT': 5, 'defensive.SACKS': 1.5, 'defensive.TFL': 2, 'defensive.PD': 1, 'interceptions.INT': 1 }).stats).toEqual({ idp_solo: 3, idp_tackle: 5, idp_sack: 1.5, idp_tfl: 2, idp_pd: 1, idp_int: 1 })
})

 it('uses only unambiguous current-season school suffixes, keeping Illinois and Illinois College separate', () => {
  const row = { id: 'p1', canonicalName: 'Jane Smith', currentTeam: 'University of Florida', position: 'WR', cfbdId: '42', fantraxId: null }
  const ref = { fantraxId: 'fx1', name: 'Smith, Jane', team: 'Florida', position: 'WR' }
  expect(planNcaafFantraxIdentityLinks([ref], [row], ['Florida', 'Illinois', 'Illinois College']).links).toHaveLength(1)
  expect(planNcaafFantraxIdentityLinks([{ ...ref, team: 'Illinois University' }], [{ ...row, currentTeam: 'Illinois' }], ['Illinois', 'Illinois College']).links).toEqual([])
})
