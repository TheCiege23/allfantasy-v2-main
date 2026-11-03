// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { computeBeta2025Winnings, beta2025ContextFromSnapshot, type Beta2025WinningsContext } from '@/lib/zombie/beta2025Winnings'
const m = (a=97.21,b=90) => ({ matchupId:'m',homeRosterId:'A',awayRosterId:'B',homeScore:a,awayScore:b,final:true })
const context = (a:string,b:string,openingA=20,openingB=30):Beta2025WinningsContext => ({
 policy:'beta_2025',openingByRoster:{A:openingA,B:openingB},statusByRoster:{A:a,B:b},
})
const calc=(a:string,b:string,hs=97.21,as=90,openingB=30) => computeBeta2025Winnings([m(hs,as)],context(a,b,20,openingB),{bashingThreshold:60,maulingThreshold:60})
const net=(result:ReturnType<typeof calc>)=>Object.fromEntries(result.netByRoster)
describe('2025 weekly winnings, rulebook pp. 7-11',()=>{
 it.each([['Survivor',2],['Zombie',4],['Whisperer',6]])('Survivor beating %s earns %s', (opponent,award)=>{
  expect(net(calc('Survivor',opponent))).toEqual({A:award,B:0})
 })
 it.each([['Zombie','Survivor'],['Zombie','Whisperer'],['Whisperer','Survivor'],['Whisperer','Zombie']])('%s beating %s takes accumulated winnings', (a,b)=>{
  expect(net(calc(a,b))).toEqual({A:30,B:-30})
 })
 it('a 7.21 point Zombie win takes 8, not a percentage of fantasy score',()=>{
  expect(net(calc('Zombie','Zombie'))).toEqual({A:8,B:-8})
 })
 it('caps loot at the available balance',()=>{ expect(net(calc('Zombie','Zombie',97.21,90,3))).toEqual({A:3,B:-3}) })
 it('awards one for a 0.24 point Zombie win',()=>{ expect(net(calc('Zombie','Zombie',65.51,65.27))).toEqual({A:1,B:-1}) })
 it('an exact 7-point margin does not round to 8',()=>{ expect(net(calc('Zombie','Zombie',97,90))).toEqual({A:7,B:-7}) })
 it.each(['Survivor','Zombie','Whisperer'])('a Survivor bash of %s stacks the normal award and all loot',b=>{
  const r=calc('Survivor',b,150,90);const award=b==='Survivor'?2:b==='Zombie'?4:6
  expect(net(r)).toEqual({A:30+award,B:-30});expect(r.transfers[0]).toMatchObject({amount:30,kind:'bashing'})
 })
 it('a 59.99 margin is below the bashing line',()=>{ expect(net(calc('Survivor','Survivor',149.99,90))).toEqual({A:2,B:0}) })
 it('a Zombie mauling another Zombie takes all the balance',()=>{
  expect(net(calc('Zombie','Zombie',150,90,100))).toEqual({A:100,B:-100})
 })
 it('ties mint no winnings and transfer nothing',()=>{ expect(net(calc('Survivor','Zombie',90,90))).toEqual({A:0,B:0}) })
 it('zero balance cannot create loot',()=>{ expect(net(calc('Whisperer','Survivor',97,90,0))).toEqual({A:0,B:0}) })
 it('uses pre-week roles when status has subsequently changed',()=>{
  expect(net(calc('Survivor','Zombie'))).toEqual({A:4,B:0})
 })
 it('supports the away winner',()=>{ expect(net(calc('Survivor','Whisperer',90,97))).toEqual({A:-20,B:20}) })
 it('skips unfinished matchups and byes',()=>{
  const r=computeBeta2025Winnings([{...m(),final:false},{...m(),awayRosterId:null}],context('Survivor','Zombie'),{bashingThreshold:60,maulingThreshold:60})
  expect([...r.netByRoster]).toEqual([])
 })
 it('refuses duplicate matchups before writing the ledger',()=>{
  expect(()=>computeBeta2025Winnings([m(),{...m(),matchupId:'m2'}],context('Zombie','Survivor'),{bashingThreshold:60,maulingThreshold:60})).toThrow('DUPLICATE_MATCHUP')
 })
 it('refuses missing roles, invalid balances and unsupported two-Whisperer outcomes',()=>{
  expect(()=>calc('unknown','Zombie')).toThrow('STATUS_REQUIRED')
  expect(()=>calc('Zombie','Zombie',97,90,-1)).toThrow('INVALID_BALANCE')
  expect(()=>calc('Whisperer','Whisperer')).toThrow('WHISPERER_PAIR_REVIEW_REQUIRED')
 })
 it('retains historical policy when a snapshot predates this change',()=>{expect(beta2025ContextFromSnapshot({version:1,teams:[]})).toBeUndefined()})
 it('does not silently use legacy rules for a malformed new snapshot',()=>{
  expect(()=>beta2025ContextFromSnapshot({winnings:{policy:'beta_2025'},teams:[]})).toThrow('SNAPSHOT_INVALID')
 })
})

it('uses the same sealed balances to calculate identical retries', () => {
  const opening = context('Zombie','Zombie')
  const once = computeBeta2025Winnings([m()], opening, {bashingThreshold:60,maulingThreshold:60})
  const twice = computeBeta2025Winnings([m()], opening, {bashingThreshold:60,maulingThreshold:60})
  expect([...twice.netByRoster]).toEqual([...once.netByRoster])
  expect(opening.openingByRoster).toEqual({A:20,B:30})
})
