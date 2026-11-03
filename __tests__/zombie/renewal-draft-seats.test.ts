import {describe,it,expect,vi} from 'vitest'
import {zombieRenewalDraftReadiness} from '@/lib/zombie/zombieRenewalDraftReadiness'
describe('expanded renewal draft readiness',()=>{
 const settings={zombie_renewal:{requiresRegisteredSeats:true}}
 function db(owners:string[],users:string[]){return {roster:{findMany:vi.fn().mockResolvedValue(owners.map(platformUserId=>({platformUserId})))},appUser:{findMany:vi.fn().mockResolvedValue(users.map(id=>({id})))}}}
 it('leaves existing non-expansion drafts unchanged without database reads',async()=>{
  const m=db([],[]);expect(await zombieRenewalDraftReadiness(m as never,'l',8,{})).toEqual({ready:true})
  expect(m.roster.findMany).not.toHaveBeenCalled()
 })
 it('blocks placeholder seats and duplicate registered managers',async()=>{
  for(const owners of [['a','open-slot-l-2'],['a','a']]){
   const r=await zombieRenewalDraftReadiness(db(owners,['a']) as never,'l',2,settings)
   expect(r.ready).toBe(false);expect(r.error).toContain('1/2')
  }
 })
 it('opens only when every seat has its own registered manager',async()=>{
  expect((await zombieRenewalDraftReadiness(db(['a','b'],['a','b']) as never,'l',2,settings)).ready).toBe(true)
  expect((await zombieRenewalDraftReadiness(db(['a'],['a']) as never,'l',2,settings)).ready).toBe(false)
 })
})
