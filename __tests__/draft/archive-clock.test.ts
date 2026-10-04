import { describe, it, expect } from 'vitest'
import { advanceArchiveClock } from '@/lib/draft-archive/clock'
const at=(seconds:number)=>new Date(Date.UTC(2026,9,4)+seconds*1000)
describe('archived active pick clock',()=>{
 it('excludes pauses and splits traded OTC time by owner',()=>{
  let clock=advanceArchiveClock(null,'start',at(0),1,'a',true).clock
  clock=advanceArchiveClock(clock,'pause',at(10),1,'a',false).clock
  clock=advanceArchiveClock(clock,'resume',at(100),1,'a',true).clock
  clock=advanceArchiveClock(clock,'ownership',at(110),1,'b',true).clock
  const result=advanceArchiveClock(clock,'selection',at(120),1,'b',true)
  expect(result.selected).toEqual({activeMs:30000,byOwner:{a:20000,b:10000}})
  expect(result.clock.totalActiveMs).toBe(30000)
 })
 it('does not invent exact OTC for a draft without its start event',()=>{
  const clock=advanceArchiveClock(null,'resume',at(0),1,'a',true).clock
  expect(advanceArchiveClock(clock,'selection',at(10),1,'a',true).selected).toBeNull()
 })
 it('a clock allowance reset does not erase elapsed OTC',()=>{
  let clock=advanceArchiveClock(null,'start',at(0),1,'a',true).clock
  clock=advanceArchiveClock(clock,'reset_timer',at(10),1,'a',true).clock
  expect(advanceArchiveClock(clock,'selection',at(20),1,'a',true).selected?.activeMs).toBe(20000)
 })
 it('refuses reordered event timestamps',()=>{
  const clock=advanceArchiveClock(null,'start',at(10),1,'a',true).clock
  expect(()=>advanceArchiveClock(clock,'pause',at(0),1,'a',false)).toThrow()
 })
})
