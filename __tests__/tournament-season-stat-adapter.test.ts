import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { defaultSeasonRules } from '@/lib/tournament/seasonRules'
import { scoreSeasonCanonicalStats, mapSeasonRiNbaStats, assessSeasonRiNbaCoverage, seasonStatBatchSchema } from '@/lib/tournament/seasonStatAdapter'
const fixture=JSON.parse(readFileSync('contracts/rolling-insights/fixtures/live.NBA.json','utf8'))
const box=fixture.data.NBA[0].player_box.away_team['191']
const supportedRules=()=>{const r=defaultSeasonRules('NBA','nba_points');const supported=new Set(['points','rebounds','assists','steals','blocks','turnovers','three_pointers_made','double_double','triple_double']);r.weights=r.weights.filter(w=>supported.has(w.statKey));return r}
it('scores a measured NBA provider box with supported frozen weights, not provider fantasy points',()=>{
 const rules=supportedRules()
 expect(scoreSeasonCanonicalStats(rules,mapSeasonRiNbaStats(rules,{...box,fantasy_points:9999}))).toBe(52.9)
 rules.weights.find(w=>w.statKey==='points')!.points=2
 expect(scoreSeasonCanonicalStats(rules,mapSeasonRiNbaStats(rules,box))).toBe(84.9)
})
it('derives double/triple bonuses per game from all five explicit categories',()=>{
 const rules=supportedRules(),raw={...box,points:10,total_rebounds:10,assists:10}
 const stats=mapSeasonRiNbaStats(rules,raw)
 expect(stats).toMatchObject({double_double:1,triple_double:1})
 expect(mapSeasonRiNbaStats(rules,{...raw,total_rebounds:0,assists:0})).toMatchObject({double_double:0,triple_double:0})
})
it.each([null,undefined,'0',NaN])('does not coerce a missing or malformed NBA stat %s to zero',value=>{
 const rules=supportedRules();expect(()=>mapSeasonRiNbaStats(rules,{...box,steals:value})).toThrow()
})
it('requires explicit unsupported custom weighted stats rather than silently dropping them',()=>{
 const rules=supportedRules();rules.weights.push({statKey:'unknown_bonus',points:3})
 expect(()=>mapSeasonRiNbaStats(rules,box)).toThrow('NBA box lacks weighted evidence for: unknown_bonus')
})
it('derives independent per-game 40+ and 50+ bonuses from measured points',()=>{
 const rules=supportedRules();rules.weights=[{statKey:'forty_plus_points_bonus',points:2},{statKey:'fifty_plus_points_bonus',points:3}]
 for(const [points,forty,fifty,total] of [[39,0,0,0],[40,1,0,2],[49,1,0,2],[50,1,1,5],[60,1,1,5]] as const) {
  const stats=mapSeasonRiNbaStats(rules,{points})
  expect(stats).toMatchObject({forty_plus_points_bonus:forty,fifty_plus_points_bonus:fifty})
  expect(scoreSeasonCanonicalStats(rules,stats)).toBe(total)
 }
 expect(()=>mapSeasonRiNbaStats(rules,{points:'50'})).toThrow('Missing or invalid NBA box field: points')
})
it('reports full NBA default coverage without inventing absent foul counts',()=>{
 const coverage=assessSeasonRiNbaCoverage(defaultSeasonRules('NBA','nba_points'))
 expect(coverage.derived).toEqual(expect.arrayContaining(['double_double','triple_double','forty_plus_points_bonus','fifty_plus_points_bonus']))
 expect(coverage.needsOtherFeed).toEqual(['technical_foul','flagrant_foul'])
 expect(coverage.unsupported).toEqual([])
})
it('does not accept unverified foul zeros injected into an NBA box',()=>{
 const raw={...box,technical_foul:0,flagrant_foul:0}
 expect(()=>mapSeasonRiNbaStats(defaultSeasonRules('NBA','nba_points'),raw)).toThrow('NBA box lacks weighted evidence for: technical_foul, flagrant_foul')
})
it('scores NFL only from complete canonical game stats and preserves negative values',()=>{
 const rules=defaultSeasonRules('NFL','ppr'),stats=Object.fromEntries(rules.weights.filter(w=>w.points!==0).map(w=>[w.statKey,0]))
 Object.assign(stats,{passing_yards:250,passing_td:2,interception:1})
 expect(scoreSeasonCanonicalStats(rules,stats)).toBe(16)
 stats.passing_yards=-10;stats.passing_td=0
 expect(scoreSeasonCanonicalStats(rules,stats)).toBe(-2.4)
 delete stats.fumble_lost
 expect(()=>scoreSeasonCanonicalStats(rules,stats)).toThrow('Missing')
})
it('uses exact decimal products and rounds once, with halves away from zero',()=>{
 const rules=supportedRules();rules.weights=[{statKey:'a',points:0.00005},{statKey:'b',points:0.00005}]
 expect(scoreSeasonCanonicalStats(rules,{a:1,b:1})).toBe(0.0001)
 expect(scoreSeasonCanonicalStats(rules,{a:-1,b:0})).toBe(-0.0001)
 rules.weights=[{statKey:'a',points:1e-5}];expect(scoreSeasonCanonicalStats(rules,{a:1})).toBe(0)
})
it('rejects unverified actual starts and nonregular-season stat envelopes',()=>{
 const base={requestId:'r',expectedRevision:0,period:1,provider:'rolling_insights',format:'nba_ri_box_v1',observedAt:'2026-10-10T00:00:00Z',coverage:'provisional',games:[{providerGameId:'g',actualStartsAt:'2026-10-09T00:00:00Z',startVerified:false,seasonType:'regular',status:'final',rows:[]}]}
 expect(()=>seasonStatBatchSchema.parse(base)).toThrow()
 base.games[0]!.startVerified=true;base.games[0]!.seasonType='preseason'
 expect(()=>seasonStatBatchSchema.parse(base)).toThrow()
})

it('blocks full frozen NBA defaults when the measured provider box lacks weighted discipline evidence',()=>{expect(()=>mapSeasonRiNbaStats(defaultSeasonRules('NBA','nba_points'),box)).toThrow('NBA box lacks weighted evidence for: technical_foul, flagrant_foul')})
