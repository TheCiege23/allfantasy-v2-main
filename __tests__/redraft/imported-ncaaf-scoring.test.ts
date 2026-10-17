import period5 from '../fixtures/cream-bowl-period5-scoring.json'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
import { calculateScoreFromSportConfig } from '@/lib/redraft/scoringEngine'
import { importedNcaafScoring } from '@/lib/redraft/importedNcaafScoring'
import { getLeagueNcaafScoringConfig, saveLeagueNcaafScoringConfig } from '@/lib/ncaaf-scoring/NcaafScoringConfigService'
import { ncaafAdapter } from '@/lib/redraft/sportAdapters/ncaaf'
import { NCAAF_CONFIG } from '@/lib/sportConfig/configs/ncaaf'
import { aggregateNcaafWeek, normalizeCfbdGameStats } from '@/lib/scoring-runtime/ncaafStatNormalization'
import fixture from '../fixtures/cream-bowl-period4-scoring.json'

const imported = { scoringSettings: { source: 'fantrax', rules: fixture.rules } }
const league = (settings: unknown = imported, sport = 'NCAAF') => db.league.findFirst.mockResolvedValue({ sport, settings })
const score = (stats: Record<string, number>, position?: string) => calculateScoreFromSportConfig('audit', 'player', 4, stats, position)
beforeEach(() => { vi.clearAllMocks(); league() })

describe('imported NCAAF scoring through the application scorer', () => {
  it('uses six-point passing touchdowns and no unstated interception/fumble penalties', async () => {
    expect(await score({ pass_yds: 200, pass_td: 2, pass_int: 3, fum_lost: 2, xp_made: 4 }, 'QB')).toBe(20)
  })
  it('applies a TE reception difference once, without relying on a native toggle', async () => {
    expect(await score({ rec: 4, rec_yds: 50 }, 'TE')).toBe(11)
    expect(await score({ rec: 4, rec_yds: 50 }, 'WR')).toBe(9)
    expect(await score({ rec: 4 }, undefined)).toBe(4)
  })
  it('cannot award a supplied TE-bonus count to a receiver or unknown position', async () => {
    expect(await score({ rec: 4, te_premium: 40 }, 'WR')).toBe(4)
    expect(await score({ rec: 4, te_premium: 40 })).toBe(4)
    expect(await score({ rec: 4, te_premium: 40 }, 'TE')).toBe(6)
  })
  it('uses source reception rules despite a misleading half-PPR template label', async () => {
    league({ ...imported, sportConfig: { scoringPreset: 'HALF_PPR' } })
    expect(await score({ rec: 4 }, 'TE')).toBe(6)
  })
  it('untouched seeded panel defaults cannot replace source rules', async () => {
    league({ ...imported, ncaaf_scoring_config: { rules: { passing_td: 4, reception: 0.5 }, lastUpdatedBy: null } })
    expect(await score({ pass_td: 1 })).toBe(6)
  })
  it('explicit canonical scoring overrides retain their existing precedence', async () => {
    league({ ...imported, sportConfig: { categoryPoints: { pass_td: 8 } } })
    expect(await score({ pass_td: 1 })).toBe(8)
  })
  it('a panel saved by a commissioner retains its precedence', async () => {
    league({ ...imported, ncaaf_scoring_config: { rules: { passing_td: 7 }, lastUpdatedBy: 'commissioner' } })
    expect(await score({ pass_td: 1 })).toBe(7)
  })
  it('does not validate unused imported weights after a commissioner saves new rules', async () => {
    league({ scoringSettings: { source: 'fantrax', rules: { rec: 'bad' } }, ncaaf_scoring_config: { rules: { passing_td: 7 }, lastUpdatedBy: 'commissioner' } })
    expect(await score({ pass_td: 1 })).toBe(7)
  })
  it('does not change native scoring defaults or fabricate enabled return scoring', async () => {
    league({})
    expect(await score({ pass_td: 1, pass_int: 1, fum_lost: 1, pr_td: 1, kr_td: 1 })).toBe(0)
  })
  it('honors explicit zero weights', async () => {
    league({ scoringSettings: { source: 'fantrax', rules: { pass_td: 0, rec: 0 } } })
    expect(await score({ pass_td: 2, rec: 4, rush_td: 1 })).toBe(0)
  })
  it('refuses malformed source weights instead of scoring defaults', async () => {
    league({ scoringSettings: { source: 'fantrax', rules: { rec: '1' } } })
    await expect(score({ rec: 4 })).rejects.toThrow(/Invalid imported/)
  })
  it('leaves other sports/providers outside this bridge', () => {
    expect(importedNcaafScoring('NFL', imported, NCAAF_CONFIG.scoringCategories)).toBeNull()
    expect(importedNcaafScoring('NCAAF', { scoringSettings: { source: 'sleeper', rules: { rec: 1 } } }, NCAAF_CONFIG.scoringCategories)).toBeNull()
  })
})

describe('athlete return touchdown normalization and scoring', () => {
  it('scores punt and kick returns separately and exactly once', async () => {
    const game = normalizeCfbdGameStats({ 'puntReturns.TD': '1', 'kickReturns.TD': 2, 'puntReturns.YDS': 72, 'puntReturns.NO': 2, 'receiving.TD': 1, 'defensive.TD': 1 })
    expect(game.stats).toMatchObject({ pr_td: 1, kr_td: 2, rec_td: 1, idp_td: 1 })
    expect(game.unmappedKeys).toEqual([])
    expect(await score(game.stats, 'WR')).toBe(24) // three returns + one receiving; no default IDP weight
  })
  it('preserves return counts through the sport adapter before league-aware scoring', async () => {
    const normalized = normalizeCfbdGameStats({ 'puntReturns.TD': 1, 'kickReturns.TD': 2 }).stats
    const parsed = ncaafAdapter.parseRawStats(normalized)
    expect(parsed).toMatchObject({ pr_td: 1, kr_td: 2, fumble_td: 0, te_premium: 0 })
    expect(await score(parsed, 'WR')).toBe(18)
  })
  it('aggregates multiple games without reusing yards or attempts as TD counts', async () => {
    const week = aggregateNcaafWeek([{ 'puntReturns.TD': 1 }, { 'kickReturns.TD': 1, 'puntReturns.TD': 0 }])
    expect(week.gamesCounted).toBe(2)
    expect(await score(week.stats, 'WR')).toBe(12)
  })
  it('supports different return weights and ignores invalid counts', async () => {
    league({ scoringSettings: { source: 'fantrax', rules: { kr_td: 9, pr_td: 3 } } })
    expect(await score(normalizeCfbdGameStats({ 'kickReturns.TD': 1, 'puntReturns.TD': 2, 'rushing.TD': 1 }).stats)).toBe(15)
    expect(normalizeCfbdGameStats({ 'puntReturns.TD': NaN, 'kickReturns.TD': 'not a stat' }).stats).toEqual({})
  })
  it('reports an unknown return key rather than silently discarding a vendor change', () => {
    expect(normalizeCfbdGameStats({ 'puntReturns.TOUCHDOWNS': 1 }).unmappedKeys).toEqual(['puntReturns.TOUCHDOWNS'])
  })
  it('retains a zero return stat while leaving an absent return stat absent', () => {
    expect(normalizeCfbdGameStats({ 'puntReturns.TD': 0 }).stats).toEqual({ pr_td: 0 })
    expect(normalizeCfbdGameStats({ 'receiving.REC': 0 }).stats).not.toHaveProperty('pr_td')
  })
})

describe('captured completed period 4: historical lineups and independent provider stats', () => {
  for (const team of fixture.teams) {
    it(`${team.team}: independently reproduces all covered source points`, async () => {
      let total = 0
      for (const player of team.players) total += await score(aggregateNcaafWeek(player.rows).stats, player.position)
      expect(total).toBeCloseTo(team.expectedIndependentPoints, 8)
      expect(total).toBeCloseTo(team.sourcePoints, 8)
    })
  }
})

describe('commissioner panel and scoring agree', () => {
  it('shows imported weights, not a default half-PPR template', async () => {
    db.league.findUnique.mockResolvedValue({ sport: 'NCAAF', settings: imported })
    const panel = await getLeagueNcaafScoringConfig('audit')
    expect(panel.source).toBe('IMPORTED_MAPPED')
    expect(panel.rules).toMatchObject({ passing_td: 6, reception: 1, te_premium: 0.5, return_td: 6, interception_thrown: 0, fumble_lost: 0, passing_2pt: 0 })
  })
  it('saving the displayed panel preserves source-equivalent TE and return scoring', async () => {
    db.league.findUnique.mockResolvedValue({ sport: 'NCAAF', settings: imported })
    const panel = await getLeagueNcaafScoringConfig('audit')
    await saveLeagueNcaafScoringConfig('audit', { presetKey: 'custom', rules: panel.rules, userId: 'commissioner' })
    league(db.league.update.mock.calls[0]![0].data.settings)
    expect(await score({ rec: 4, pr_td: 1, kr_td: 1, pass_int: 1, fum_lost: 1 }, 'TE')).toBe(18)
  })
})

 describe('conversion roles through application scoring',()=>{
  it('credits receiving/rushing tries while an unscored passing try contributes nothing',async()=>{expect(await score({pass_2pt:1,rec_2pt:1,rush_2pt:1,two_pt:3})).toBe(4)})
  it('honors distinct commissioner role weights without adding legacy aggregate points',async()=>{league({ncaaf_scoring_config:{lastUpdatedBy:'commissioner',rules:{passing_2pt:1,rushing_2pt:3,receiving_2pt:4}}});expect(await score({pass_2pt:1,rush_2pt:1,rec_2pt:1,two_pt:3})).toBe(8)})
 })

 it('retains legacy aggregate conversions through the adapter',async()=>{league({ncaaf_scoring_config:{lastUpdatedBy:'commissioner',rules:{passing_2pt:0,rushing_2pt:3,receiving_2pt:3}}});expect(await score(ncaafAdapter.parseRawStats({two_pt:1}))).toBe(3)})

 describe('second completed period with conversion events and a named provider discrepancy',()=>{
  for(const team of period5.teams)it(team.team+': replays captured independent provider evidence',async()=>{let total=0;for(const p of team.players)total+=await score(aggregateNcaafWeek(p.rows).stats,p.position);expect(total).toBeCloseTo(team.expectedIndependentPoints,8);if(team.team===period5.providerDiscrepancy.team)expect(total-team.sourcePoints).toBeCloseTo(period5.providerDiscrepancy.sourcePointDelta,8);else expect(total).toBeCloseTo(team.sourcePoints,8)})
  it("ESPN's explicit final passing line explains the source discrepancy without changing scoring weights",async()=>{const team=period5.teams.find(t=>t.team===period5.providerDiscrepancy.team)!;let total=0;for(const p of team.players){const rows=p.rows.map(r=>p.name===period5.providerDiscrepancy.athlete?{...r,'passing.YDS':period5.providerDiscrepancy.espn}:r);total+=await score(aggregateNcaafWeek(rows).stats,p.position)}expect(total).toBeCloseTo(team.sourcePoints,8)})
 })

 it('keeps native NCAAF conversion weights separate from Fantrax defaults',async()=>{league({});expect(await score({pass_2pt:1,rush_2pt:1,rec_2pt:1})).toBe(6)})
 it('does not suppress NFL aggregate conversion scoring',async()=>{league({},'NFL');expect(await score({two_pt:1,pass_2pt:1})).toBe(2)})
