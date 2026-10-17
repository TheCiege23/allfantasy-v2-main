import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({})); vi.mock('@/lib/prisma', () => ({ prisma: {} })); vi.mock('@/lib/schedule-stats', () => ({ ingestSportStats: vi.fn() }))
import { extractEspnConversions, applyConversionEvidence, conversionCandidateGames, enrichCfbdConversions } from '@/lib/stats/cfbdConversions'
import { normalizeCfbdGameStats } from '@/lib/scoring-runtime/ncaafStatNormalization'
import { projectFantraxHistory } from '@/lib/redraft/fantraxNativePresentation'
import { importedNcaafScoring, importedNcaafPanelRules } from '@/lib/redraft/importedNcaafScoring'
import { getSportConfig } from '@/lib/sportConfig'
import { fantraxScoringRules } from '@/lib/league-import/fantrax/fantraxScoring'
const rows = [
 { playerId: '5079516', gameId: 'cfbd:401856697', statPayload: { name: 'KJ Jackson', _team: 'Arkansas', 'passing.TD': 1, 'rushing.TD': 2 } },
 { playerId: '4805256', gameId: 'cfbd:401856697', statPayload: { name: 'Sutton Smith', _team: 'Arkansas', 'receiving.REC': 3 } },
]
const summary = { header: { id: '401856697', competitions: [{ competitors: [{ team: { id: '8', location: 'Arkansas' } }] }] }, boxscore: { players: [{ team: { id: '8' }, statistics: [{ athletes: [{ athlete: { id: '5079516', displayName: 'KJ Jackson' } }, { athlete: { id: '4805256', displayName: 'Sutton Smith' } }] }] }] }, scoringPlays: [{ id: '401856697700', team: { id: '8' }, text: 'KJ Jackson 11 Yd Run (KJ Jackson Pass to Sutton Smith for Two-Point Conversion)' }] }
describe('verified athlete conversion enrichment', () => {
 it('credits passer and receiver separately, once, using captured exact IDs', () => {
  const parsed = extractEspnConversions(summary, rows[0]!.gameId, rows); expect(parsed.gaps).toEqual([]); expect(parsed.evidence.map(e => [e.playerId, e.key])).toEqual([['5079516','conversions.PASS'],['4805256','conversions.REC']])
  const enriched = applyConversionEvidence(rows, [...parsed.evidence,...parsed.evidence]); expect(normalizeCfbdGameStats(enriched[1]!.statPayload).stats.rec_2pt).toBe(1); expect(normalizeCfbdGameStats(enriched[0]!.statPayload).stats).toMatchObject({ pass_2pt: 1, rush_td: 2 }); expect(enriched[1]!.statPayload._conversionSource).toBe('espn-summary')
  expect(applyConversionEvidence(enriched, parsed.evidence)).toEqual(enriched)
 })
 it('does not credit failed, unnamed, defensive or mismatched-game conversions', () => {
  for (const text of ['TD (Two-Point Pass Conversion Failed)', 'Defensive PAT Conversion', 'TD (Unknown Run for Two-Point Conversion)']) expect(extractEspnConversions({...summary, scoringPlays:[{...summary.scoringPlays[0],text}]},rows[0]!.gameId,rows).evidence).toEqual([])
  expect(extractEspnConversions(summary,'cfbd:999',rows).evidence).toEqual([])
 })
 it('refuses wrong ID, same-name school, duplicate IDs and conflicts', () => {
  expect(extractEspnConversions(summary,rows[0]!.gameId,[{...rows[1]!,playerId:'999'}]).evidence).toEqual([])
  expect(extractEspnConversions(summary,rows[0]!.gameId,[{...rows[1]!,statPayload:{...rows[1]!.statPayload,_team:'Tulsa'}}]).evidence).toEqual([])
  expect(extractEspnConversions({...summary,scoringPlays:[summary.scoringPlays[0],{...summary.scoringPlays[0],text:'TD (KJ Jackson Run for Two-Point Conversion)'}]},rows[0]!.gameId,rows).evidence).toEqual([])
 })
 it('only uses XP deficits to select requests, never as a conversion count', async () => {
  expect(conversionCandidateGames(rows)).toEqual(['cfbd:401856697'])
  const fail=await enrichCfbdConversions(rows,async()=>{throw Error('unavailable')});expect(fail.rows).toEqual(rows);expect(fail.gaps).toHaveLength(1)
  const bounded=await enrichCfbdConversions(rows,async()=>summary,0);expect(bounded.evidence).toEqual([]);expect(bounded.gaps[0]).toContain('deferred')
 })
})
describe('conversion scoring mapping',()=>{
 it('excludes passer from the Fantrax conversion-scores category',()=>{
  const info:any={scoringSystem:{type:'HEAD_TO_HEAD_POINTS_BASED',scoringCategorySettings:[{configs:[{points:2,scoringCategory:{code:'INDIVIDUAL_TWO_POINT_CONVERSIONS_SCORES'}}]}]}}
  expect(fantraxScoringRules(info).rules.map(r=>r.stat_key)).toEqual(['rush_2pt','rec_2pt'])
  const settings={scoringSettings:{source:'fantrax',rules:{pass_2pt:2,rush_2pt:2,rec_2pt:2}},fantrax_settings:{scoringSystem:info.scoringSystem}}
  const scoring=importedNcaafScoring('NCAAF',settings,getSportConfig('NCAAF').scoringCategories)!;expect(scoring.overrides).toMatchObject({pass_2pt:0,rush_2pt:2,rec_2pt:2,two_pt:0})
  expect(importedNcaafPanelRules(settings,['passing_2pt','rushing_2pt','receiving_2pt'])).toMatchObject({passing_2pt:0,rushing_2pt:2,receiving_2pt:2})
 })
})
describe('Fantrax native history presentation',()=>{
 const periods=[{number:4,startDate:'2026-09-22T16:00:00Z',endDate:'2026-09-29T15:59:59Z'},{number:5,startDate:'2026-09-29T16:00:00Z',endDate:'2026-10-06T23:59:59Z'}]
 const base:any={seasonId:'season',leagueId:'league',info:{scoringPeriods:periods},teamIds:{a:'ra',b:'rb'},rosters:[{id:'ra'},{id:'rb'}],rows:[{week:4,homeTeamId:'a',awayTeamId:'b',homeScore:0,awayScore:0,played:true},{week:5,homeTeamId:'a',awayTeamId:'b',homeScore:null,awayScore:null,played:false}],now:new Date('2026-10-05')}
 it('preserves genuine scoreless final ties, missing future scores, and source dates',()=>{const r=projectFantraxHistory(base);expect(r.currentWeek).toBe(5);expect(r.matchups[0]).toMatchObject({homeScore:0,awayScore:0,status:'final',readOnly:true,periodEnd:periods[0]!.endDate});expect(r.matchups[1]).toMatchObject({homeScore:null,status:'scheduled'})})
 it('fails closed for unmapped rosters and protects native score authority',()=>{const r=projectFantraxHistory({...base,teamIds:{a:'missing',b:'rb'}});expect(r.matchups).toEqual([]);expect(r.incompleteMatchups).toBe(2)})
})

 it('does not treat a live empty scoring summary as verified retraction evidence',async()=>{const prior=applyConversionEvidence(rows,extractEspnConversions(summary,rows[0]!.gameId,rows).evidence);const live={...summary,scoringPlays:[]};const r=await enrichCfbdConversions(prior,async()=>live);expect(r.verifiedGames).toEqual([]);expect(r.rows).toEqual(prior);const final={...live,header:{...live.header,competitions:[{...live.header.competitions[0],status:{type:{completed:true}}}]}};const corrected=await enrichCfbdConversions(prior,async()=>final);expect(corrected.verifiedGames).toEqual([rows[0]!.gameId]);expect(corrected.rows[1]!.statPayload).not.toHaveProperty('conversions.REC')})
