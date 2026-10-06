import {describe,it,expect} from 'vitest'
import {weeklyOutcomes,validatedWeeklyRosterEvidence,type WeeklyRosterEvidence} from '@/lib/draft-archive/weeklyOutcomeModel'
const picks=[{playerId:'p',rosterId:'a',playerName:'P',position:'WR',keeper:false}]
const player=(playerId:string,points:number,starter=false)=>({playerId,points,starter,position:'WR',finalized:true})
const evidence:WeeklyRosterEvidence[]=[{week:1,rosterId:'a',players:[player('p',10,true),player('bench',20),{...player('qb',30),position:'QB'}],slots:[{slot:'REC_FLEX',playerId:'p'}]},{week:1,rosterId:'b',players:[player('other',5,true)],slots:[{slot:'WR',playerId:'other'}]}]
describe('finalized weekly substitution evidence',()=>{
 it('uses the best legal own-bench player and retains a negative difference',()=>{
  const result=weeklyOutcomes(picks,[1],['a','b'],evidence)
  expect(result.finalizedWeeks).toEqual([1]);expect(result.replacements[0]).toMatchObject({state:'ready',replacementPlayerId:'bench',replacementPoints:20,difference:-10})
 })
 it('withholds finalization for missing, provisional, duplicate and cross-roster records',()=>{
  for(const rows of [evidence.slice(0,1),[evidence[0],evidence[0],evidence[1]],[{...evidence[0],players:evidence[0].players.map(p=>({...p,finalized:false}))},evidence[1]],[evidence[0],{...evidence[1],players:[player('p',5,true)]}]])expect(weeklyOutcomes(picks,[1],['a','b'],rows).finalizedWeeks).toEqual([])
 })
 it('blocks comparisons for unknown positions, unknown slots and inconsistent lineup assignments',()=>{
  for(const row of [{...evidence[0],players:[evidence[0].players[0],{...player('bench',20),position:null}]},{...evidence[0],slots:[{slot:'UNKNOWN',playerId:'p'}]},{...evidence[0],slots:[]}])expect(weeklyOutcomes(picks,[1],['a','b'],[row,evidence[1]]).replacements[0].state).toBe('unavailable')
 })
 it('does not invent a replacement for a bench player or departure',()=>{
  for(const playerId of ['bench','departed'])expect(weeklyOutcomes([{...picks[0],playerId}],[1],['a','b'],evidence).replacements[0].difference).toBeNull()
 })
 it('strictly parses and strips metadata, refusing oversized/malformed evidence',()=>{
  expect(validatedWeeklyRosterEvidence(evidence)).toEqual(evidence)
  expect(validatedWeeklyRosterEvidence([{...evidence[0],secret:'PRIVATE',players:evidence[0].players.map(p=>({...p,secret:'PRIVATE'}))}])?.[0]).not.toHaveProperty('secret')
  for(const raw of [null,[{}],[{...evidence[0],players:[{...player('p',0),points:'0'}]}],Array(577).fill(evidence[0])])expect(validatedWeeklyRosterEvidence(raw)).toBeNull()
 })
 it('accepts bounded deep-roster seasons above 10,000 players without relaxing per-roster limits',()=>{
  const teams=Array.from({length:32},(_,i)=>String(i)),weeks=Array.from({length:18},(_,i)=>i+1)
  const proof:WeeklyRosterEvidence[]=weeks.flatMap(week=>teams.map(rosterId=>({week,rosterId,players:Array.from({length:100},(_,i)=>player(rosterId+':'+i,0)),slots:[]})))
  expect(validatedWeeklyRosterEvidence(proof)).toHaveLength(576)
  expect(weeklyOutcomes([],weeks,teams,proof).finalizedWeeks).toEqual(weeks)
  expect(validatedWeeklyRosterEvidence([{...proof[0],players:[...proof[0].players,player('extra',0)]}])).toBeNull()
 })

})
