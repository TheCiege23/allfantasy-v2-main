import {describe,it,expect} from 'vitest'
import {scoreDraftRates,draftSlotEligibility} from '@/lib/draft-archive/sportEvidence'
import {buildReplay,replayAt} from '@/lib/draft-archive/phase4Model'
import {draftDayReport} from '@/lib/draft-archive/analysisModel'
import type {PreparationContext} from '@/lib/core-app/draftPreparationModel'
const start='2026-08-01T00:00:00Z'
describe('sport-scoped draft comparisons',()=>{
 it('keeps overlapping sport slots separate and never falls back unknown sports to NFL',()=>{
  expect(draftSlotEligibility('NBA')?.G).toEqual(['PG','SG','G']);expect(draftSlotEligibility('NHL')?.G).toEqual(['G']);expect(draftSlotEligibility('unknown')).toBeNull()
  expect(scoreDraftRates({receptions:5},{rec:1},'NBA')).toBeNull()
 })
 it('supports frozen component-rate replay and descriptive ranks for each points sport',()=>{
  for(const [sport,position,slot] of [['NBA','PG','G'],['NCAAB','PG','G'],['NHL','LW','W'],['MLB','SP','P'],['SOCCER','ST','FWD'],['NCAAF','WR','WR']]){
   const context:PreparationContext={sport,season:2026,leagueType:'redraft',draftType:'snake',teamCount:2,purpose:'standard',playerPool:'all',scoring:'points',scoringRules:{rec:1},rosterSlots:[slot,'BN']}
   const basis={version:'draft-analysis-basis-v2',state:'captured',sport,capturedAt:start,entries:[20,15,10].map((points,i)=>({playerId:'p'+i,position,computedAt:start,perGameRates:{rec:points}}))}
   const picks=[0,1].map(i=>({playerId:'p'+i,rosterId:i?'b':'a',playerName:'P'+i,position,keeper:false,overall:i+1}))
   const data=buildReplay(basis,context,start,picks,[])
   expect(data.state,sport).toBe('ready');expect(replayAt(data,1)?.actual.gain).toBe(20)
   expect(draftDayReport(basis,context,picks,[{rosterId:'a',name:'A'},{rosterId:'b',name:'B'}],start,[]).state,sport).toBe('ready')
   expect(buildReplay({...basis,sport:'NFL'},context,start,picks,[]).state).toBe('unavailable')
  }
 })
 it('blocks unsupported scoring coverage',()=>{
  expect(scoreDraftRates({pts:10},{pts:1,missing:2},'NBA')?.coverage.unmatched).toEqual(['missing'])
 })
})

it('respects recorded multi-position eligibility without cross-sport aliases',()=>{
 expect(draftSlotEligibility('NBA',['PG/SG'])?.PG).toContain('PG/SG')
 expect(draftSlotEligibility('NBA',['PG/SG'])?.C).not.toContain('PG/SG')
 expect(draftSlotEligibility('NBA',['WR/PG'])?.PG).not.toContain('WR/PG')
 expect(draftSlotEligibility('NHL')?.G).toEqual(['G'])
})
