import { describe, expect, it } from 'vitest'
import { buildFinalizedOpeningStandings, type OpeningStandingWeek } from '@/lib/tournament/seasonFinalizedStandings'
function fixture() {
 const entrants = Array.from({length:4},(_,i)=>({id:'e'+i,displayName:'Team '+i,leagueId:'l'+(i%2),leagueKey:'pool'+(i%2),leagueName:'League '+(i%2),rosterId:'r'+i}))
 const weeks: OpeningStandingWeek[] = [0,1].map(i=>({leagueKey:'pool'+i,period:1,state:'finalized',revision:1,points:entrants.filter(e=>e.leagueKey==='pool'+i).map((e,j)=>({rosterId:e.rosterId,points:j*10+i}))}))
 return {entrants,weeks,periods:[1],throughPeriod:1,tiebreakers:['best_week','wins','previous_seed'] as ('best_week'|'wins'|'previous_seed')[]}
}
describe('finalized opening standings projection',()=>{
 it('ranks the full field from verified weeks, without inventing wins or enabling advancement',()=>{
  const report=buildFinalizedOpeningStandings(fixture())
  expect(report.scoresFinal).toBe(true);expect(report.rows.map(r=>r.pointsFor)).toEqual([11,10,1,0])
  expect(report.rows.every(r=>r.wins===null)).toBe(true)
  expect(report).toMatchObject({verifiedWeeks:2,requiredWeeks:2,seedingReady:false,canAdvance:false,launchReady:false})
  expect(JSON.stringify(report)).not.toContain('rosterId')
 })
 it.each(['missing','unfinalized','review_required'] as const)('excludes %s weeks and hides ranks and unknown totals',state=>{
  const f=fixture();f.weeks[0]!.state=state
  const report=buildFinalizedOpeningStandings(f)
  expect(report.scoresFinal).toBe(false);expect(report.rows.every(r=>r.rank===null&&!r.tied)).toBe(true)
  expect(report.rows.filter(r=>r.leagueKey==='pool0').every(r=>r.pointsFor===null&&r.knownFinalizedPoints===null)).toBe(true)
 })
 it('preserves known subtotals and explicit missing weeks across periods',()=>{
  const f=fixture();f.periods.push(2);f.throughPeriod=2
  f.weeks.push(...[0,1].map(i=>({leagueKey:'pool'+i,period:2,state:'missing' as const,revision:0})))
  const report=buildFinalizedOpeningStandings(f)
  expect(report.rows.find(r=>r.entrantId==='e0')).toMatchObject({pointsFor:null,knownFinalizedPoints:0,missingPeriods:[2]})
 })
 it('does not apply a later best-week tiebreaker beyond unknown wins',()=>{
  const f=fixture();f.tiebreakers=['wins','best_week'];f.periods.push(2);f.throughPeriod=2
  f.weeks.forEach(w=>w.points!.forEach(p=>{p.points=10}))
  f.weeks.push(...f.weeks.map(w=>({...structuredClone(w),period:2})))
  f.weeks[0]!.points![0]!.points=5;f.weeks[2]!.points![0]!.points=15
  const report=buildFinalizedOpeningStandings(f)
  expect(report.rows.every(r=>r.rank===1&&r.tied)).toBe(true)
 })
 it.each(['duplicate week','missing status','foreign roster','incomplete teams','bad score','duplicate entrant','wrong range'])('refuses %s',kind=>{
  const f=fixture()
  if(kind==='duplicate week')f.weeks.push(f.weeks[0]!)
  if(kind==='missing status')f.weeks.pop()
  if(kind==='foreign roster')f.weeks[0]!.points![0]!.rosterId='foreign'
  if(kind==='incomplete teams')f.weeks[0]!.points!.pop()
  if(kind==='bad score')f.weeks[0]!.points![0]!.points=NaN
  if(kind==='duplicate entrant')f.entrants[1]=f.entrants[0]!
  if(kind==='wrong range')f.throughPeriod=2
  expect(()=>buildFinalizedOpeningStandings(f)).toThrow()
 })
})

it('uses verified win credits only when the full requested field has matchup results',()=>{
 const f=fixture()
 f.weeks[0]!.points![0]!.points=10;f.weeks[0]!.points![1]!.points=20
 f.weeks[1]!.points![0]!.points=10;f.weeks[1]!.points![1]!.points=0
 f.weeks.forEach(w=>{w.matchupsState='verified';w.outcomes=w.points!.map((p,i)=>{const win=w.leagueKey==='pool0'?i===1:i===0;return {rosterId:p.rosterId,wins:win?1:0,losses:win?0:1,ties:0}})})
 const complete=buildFinalizedOpeningStandings(f)
 expect(complete.matchupsFinal).toBe(true)
 expect(complete.rows.map(r=>r.wins)).toEqual([1,1,0,0])
 expect(complete.rows.map(r=>r.rank)).toEqual([1,2,3,4])
 expect(complete.blockers.some(b=>b.includes('verified matchup'))).toBe(false)
 f.weeks[0]!.matchupsState='missing';delete f.weeks[0]!.outcomes
 const partial=buildFinalizedOpeningStandings(f)
 expect(partial.matchupsFinal).toBe(false)
 expect(partial.rows.filter(r=>r.pointsFor===10).every(r=>r.rank===2&&r.tied)).toBe(true)
 expect(partial.rows.find(r=>r.leagueKey==='pool0')!.wins).toBeNull()
})
it('preserves a known zero-win subtotal while another matchup week is missing',()=>{
 const f=fixture();f.weeks.forEach(w=>{w.matchupsState='verified';w.outcomes=w.points!.map((p,i)=>({rosterId:p.rosterId,wins:i===0?0:1,losses:i===0?1:0,ties:0}))})
 f.periods.push(2);f.throughPeriod=2;f.weeks.push(...[0,1].map(i=>({leagueKey:'pool'+i,period:2,state:'missing' as const,revision:0})))
 const report=buildFinalizedOpeningStandings(f)
 expect(report.rows.find(r=>r.entrantId==='e0')).toMatchObject({wins:null,knownVerifiedWins:0,missingMatchupPeriods:[2]})
})
