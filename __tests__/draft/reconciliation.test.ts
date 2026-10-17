import {describe,it,expect} from 'vitest'
import {stableFinalWeeks} from '@/lib/draft-archive/reconciliationModel'
const now=new Date('2026-10-06T12:00:00Z'),old='2026-10-05T23:00:00Z'
const evidence=['a','b'].map((rosterId,i)=>({week:1,rosterId,players:[{playerId:'p'+i,position:'WR',points:i,starter:true,finalized:false}],slots:[{slot:'WR',playerId:'p'+i}]}))
const games=[{week:1,startTime:new Date('2026-10-01'),status:'final'}]
describe('provider score reconciliation',()=>{
 it('requires unchanged complete evidence past both correction windows',()=>{
  expect(stableFinalWeeks(evidence,evidence,now.toISOString(),old,['a','b'],[1],games,now)).toEqual([1])
  expect(stableFinalWeeks(evidence,evidence,now.toISOString(),'2026-10-06T01:00:00Z',['a','b'],[1],games,now)).toEqual([])
 })
 it('blocks changing scores, partial inventories, future observations and live games',()=>{
  const changed=evidence.map(e=>({...e,players:e.players.map(p=>({...p,points:2}))}))
  for(const previous of [changed,evidence.slice(0,1),null])expect(stableFinalWeeks(evidence,previous,now.toISOString(),old,['a','b'],[1],games,now)).toEqual([])
  expect(stableFinalWeeks(evidence,evidence,'2027-01-01',old,['a','b'],[1],games,now)).toEqual([])
  expect(stableFinalWeeks(evidence,evidence,now.toISOString(),old,['a','b'],[1],[{...games[0],status:'active'}],now)).toEqual([])
  expect(stableFinalWeeks(evidence,evidence,now.toISOString(),old,['a','b'],[1],[{...games[0],startTime:new Date('2026-10-06')}],now)).toEqual([])
 })
})
