import { describe,it,expect } from 'vitest'
import { resolveCategoryMatchup, computeCategoryValue, accumulateTeamTotals, MLB_FIVE_BY_FIVE, rankRotisserieTeams } from '@/lib/category-scoring'
import { normalizeMlbGameStats } from '@/lib/scoring-runtime/mlbStatNormalization'
describe('MLB category arithmetic',()=>{
  it('aggregates ratio components rather than averaging player averages',()=>{
    const totals=accumulateTeamTotals([{h:1,ab:2,er:1,outs:2,p_h:2,p_bb:1},{h:3,ab:8,er:2,outs:19,p_h:2,p_bb:2}])
    expect(computeCategoryValue(totals,MLB_FIVE_BY_FIVE.find(c=>c.id==='avg')!)).toBe(.4)
    expect(computeCategoryValue(totals,MLB_FIVE_BY_FIVE.find(c=>c.id==='era')!)).toBeCloseTo(81/21)
    expect(computeCategoryValue(totals,MLB_FIVE_BY_FIVE.find(c=>c.id==='whip')!)).toBe(1)
  })
  it('does not award perfect ERA/WHIP to a team with zero innings',()=>{
    const r=resolveCategoryMatchup({},{outs:3,er:1,p_h:2,p_bb:1},MLB_FIVE_BY_FIVE)
    expect(r.categories.find(c=>c.categoryId==='era')).toMatchObject({aValue:null,bValue:9,winner:'b'})
    expect(r.categories.find(c=>c.categoryId==='whip')?.winner).toBe('b')
  })
  it('keeps hits and at bats and converts baseball innings before aggregation',()=>{
    expect(normalizeMlbGameStats({group:'batting',stats:{AB:4,H:2}}).stats).toMatchObject({ab:4,h:2})
    expect(normalizeMlbGameStats({group:'pitching',stats:{IP:5.2,H:3,BB:2,ER:1}}).stats).toMatchObject({outs:17,p_h:3,p_bb:2,er:1})
  })
  it('splits tied roto rank points and respects lower-is-better categories',()=>{
    const result=rankRotisserieTeams([{id:'a',stats:{hr:2,outs:3,er:0}},{id:'b',stats:{hr:2,outs:3,er:1}},{id:'c',stats:{hr:1}}],MLB_FIVE_BY_FIVE.filter(c=>['hr','era'].includes(c.id)))
    expect(result.get('a')?.categories.hr.points).toBe(2.5)
    expect(result.get('b')?.categories.hr.points).toBe(2.5)
    expect(result.get('a')?.categories.era.points).toBe(3)
    expect(result.get('c')?.categories.era.points).toBe(1)
  })
})

import { importedMlbScoring } from '@/lib/league-creation/canonical/importedMlbScoring'
import { isScoringPresetValidForContext, buildScoringFromPresetId } from '@/lib/league-creation-preset/scoring-presets'
it('enables both H2H records on lineup concepts and rejects best ball',()=>{
 for(const preset of ['mlb_5x5_each','mlb_5x5_most','mlb_6x6_each','mlb_6x6_most']) {
  expect(isScoringPresetValidForContext(preset,{sport:'MLB',leagueType:'redraft',idpSelected:false})).toBe(true)
  expect(buildScoringFromPresetId(preset,{sport:'MLB',leagueType:'redraft',idpSelected:false}).scoringSettings.scoringMode).toBe('h2h_category')
  expect(isScoringPresetValidForContext(preset,{sport:'MLB',leagueType:'best_ball',idpSelected:false})).toBe(false)
 }
})
it('rejects a source qualification or category direction that would change its rules',()=>{
 const source={scoringSettings:{format:'H2H_CATEGORIES',rules:{}},espn_settings:{scoringSettings:{scoringType:'H2H_CATEGORIES',scoringItems:[20,5,21,23,2,53,57,48,47,41].map(statId=>({statId,points:1,isReverseItem:[47,41].includes(statId)}))}}}
 expect(importedMlbScoring(source)).toMatchObject({scoringMode:'h2h_category',categoryPresetId:'mlb_5x5',categoryRecordMode:'each'})
 expect(()=>importedMlbScoring({...source,espn_settings:{scoringSettings:{...source.espn_settings.scoringSettings,statQualificationMinimum:{limitValue:120,statId:34}}}})).toThrow('qualifications')
 const wrong=structuredClone(source); wrong.espn_settings.scoringSettings.scoringItems[8].isReverseItem=false
 expect(()=>importedMlbScoring(wrong)).toThrow('direction')
})
