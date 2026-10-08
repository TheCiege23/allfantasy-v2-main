import { describe, expect, it } from 'vitest'
import { compareFantraxActuals, verifyFantraxWeeklyActuals, fantraxActualWriteDecision } from '../lib/league-import/fantrax/fantraxWeeklyActuals'
const header='"ID","Player","Status","Opponent","Fantasy Points","YDS-Pa","TD-Pa","YDS-Ru","TDRu","REC","YDS-RC","TD-Rc"'
const csv=(points='-0.2',opponent='A 7@B 14 F',status='Act')=>`"","Offense"\n${header}\n"*abc*","Player, One","${status}","${opponent}","${points}","0","0","-2","0","0","0","0"\n`
const roster={teamName:'Alpha',rosterItems:[{id:'abc',status:'ACTIVE',position:'QB'}]}
const check=(text=csv(),total=-.2)=>verifyFantraxWeeklyActuals({csv:text,sourceTeamId:'team',roster,sourceTotal:total})
describe('Fantrax weekly actual evidence',()=>{
 it('preserves negative actuals and quoted names',()=>expect(check().players[0]).toEqual({playerId:'abc',name:'Player, One',points:-.2,isStarter:true}))
 it('accepts a genuine zero and bye',()=>expect(check(csv('0','Bye'),0).starterTotal).toBe(0))
 it.each(['','NaN','Infinity','1x','1e2'])('rejects malformed or missing points %s',p=>expect(()=>check(csv(p))).toThrow())
 it('rejects projected or unfinished opponents',()=>expect(()=>check(csv('-.2','A Sat 3:00PM'))).toThrow())
 it('rejects season totals and wrong-period exports through the independent team total',()=>expect(()=>check(csv('500'),-.2)).toThrow('starter total'))
 it('rejects stale lineup status',()=>expect(()=>check(csv('-0.2','Bye','Res'))).toThrow('period roster'))
 it('rejects duplicates',()=>expect(()=>check(csv()+csv().split('\n')[2]+'\n')).toThrow('duplicate'))
 it('rejects omitted roster players',()=>expect(()=>verifyFantraxWeeklyActuals({csv:csv(),sourceTeamId:'team',roster:{...roster,rosterItems:[...roster.rosterItems,{id:'other',status:'RESERVE',position:'RB'}]},sourceTotal:-.2})).toThrow('omits'))
 it('requires raw category stats',()=>expect(()=>check(csv().replace('YDS-Pa','Not Stats'))).toThrow('column'))
 it('reports missing calculation distinctly from a zero',()=>expect(compareFantraxActuals([{playerId:'abc',name:'A',isStarter:true,points:0}],new Map())[0]).toMatchObject({status:'missing_calculation',delta:null}))
 it('records the exact Arnold discrepancy without changing either score',()=>expect(compareFantraxActuals([{playerId:'068wu',name:'Jackson Arnold',isStarter:true,points:49.88}],new Map([['068wu',50.08]]))[0]).toMatchObject({status:'discrepancy',points:49.88,calculatedPoints:50.08,delta:.2}))
})

describe('source actual write guards',()=>{
 const next={points:0,rosterId:7,isStarter:true}
 const prior={...next,source:'fantrax',isFinalized:true}
 it('makes identical finalized imports a no-op',()=>expect(fantraxActualWriteDecision(next,prior)).toBe('unchanged'))
 it('refuses score corrections to finalized source rows',()=>expect(()=>fantraxActualWriteDecision({...next,points:2},prior)).toThrow('Finalized'))
 it('refuses a different source even when values agree',()=>expect(()=>fantraxActualWriteDecision(next,{...prior,source:'sleeper'})).toThrow('another source'))
 it('updates unfinalized lineup membership as well as points',()=>expect(fantraxActualWriteDecision({...next,isStarter:false},{...prior,isFinalized:false})).toBe('write'))
})
