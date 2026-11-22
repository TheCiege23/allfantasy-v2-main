// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h=vi.hoisted(()=>({
 ledger:new Map<string,{rosterId:string;amount:number;source:string}>(),
 totals:new Map<string,number>(), failSecond:false, snapshot:undefined as unknown, transaction:vi.fn(), results:vi.fn(),
 writes:0,
}))
vi.mock('@/lib/prisma',()=>({prisma:{
 zombieWeeklyResolution:{findUnique:vi.fn(async()=>({settlementSnapshot:h.snapshot}))},
 $transaction:h.transaction,
}}))
vi.mock('@/lib/zombie/ZombieInfectionEngine',()=>({loadNativeWeekResults:h.results}))
vi.mock('@/lib/zombie/zombieRules',()=>({getZombieRulesForSport:vi.fn(async()=>({bashingThreshold:30,maulingThreshold:50}))}))
import { settleWeeklyWinnings } from '@/lib/zombie/weeklyWinningsEngine'
const input={zombieLeagueId:'z1',leagueId:'L1',sport:'NFL',season:2026,week:2,infected:[]}
beforeEach(()=>{
 vi.clearAllMocks();h.ledger.clear();h.totals.clear();h.writes=0;h.failSecond=false
 h.snapshot={rules:{bashingThreshold:60,maulingThreshold:60},winnings:{policy:'beta_2025',openingByRoster:{A:20,B:30}},teams:[{rosterId:'A',status:'Zombie'},{rosterId:'B',status:'Zombie'}]}
 h.results.mockResolvedValue([{matchupId:'m',homeRosterId:'A',awayRosterId:'B',homeScore:97.21,awayScore:90,final:true}])
 h.transaction.mockImplementation(async(callback:(tx:unknown)=>Promise<unknown>)=>{
  const before=new Map(h.ledger)
  try {return await callback({
   $queryRaw:vi.fn(async()=>[{id:'z1'}]),
   zombieWeeklyWinnings:{
    findMany:vi.fn(async({where}:{where:{week?:number}})=> where.week ? [...h.ledger.values()] : [{rosterId:'A',amount:20},{rosterId:'B',amount:30},...h.ledger.values()]),
    upsert:vi.fn(async({create}:{create:{rosterId:string;amount:number;source:string}})=>{
     h.writes++;if(h.failSecond&&h.writes===2)throw new Error('forced database failure')
     h.ledger.set(create.rosterId,create);return create
    }),
   },
   zombieLeagueTeam:{updateMany:vi.fn(async({where,data}:{where:{rosterId:string};data:{totalWinnings:number}})=>{h.totals.set(where.rosterId,data.totalWinnings);return {count:1}})},
   roster:{findMany:vi.fn(async()=>[{id:'A',platformUserId:'a'},{id:'B',platformUserId:'b'}])},
   zombieInfectionEvent:{updateMany:vi.fn(async()=>({count:0}))},
  })} catch(e){h.ledger.clear();for(const [k,v]of before)h.ledger.set(k,v);throw e}
 })
})
describe('2025 ledger settlement service',()=>{
 it('writes both deltas in one serializable transaction',async()=>{
  const result=await settleWeeklyWinnings(input)
  expect(result).toMatchObject({teams:2,totalTransferred:8})
  expect([...h.ledger.values()]).toEqual([
   expect.objectContaining({rosterId:'A',amount:8,source:'weekly_settlement_2025'}),
   expect.objectContaining({rosterId:'B',amount:-8,source:'weekly_settlement_2025'}),
  ])
  expect(Object.fromEntries(h.totals)).toEqual({A:28,B:22})
  expect(h.transaction).toHaveBeenCalledWith(expect.any(Function),{isolationLevel:'Serializable'})
 })
 it('a repeated run rewrites the same weekly deltas, preserving the opening balances',async()=>{
  await settleWeeklyWinnings(input);await settleWeeklyWinnings(input)
  expect(h.ledger.size).toBe(2);expect(h.ledger.get('A')?.amount).toBe(8);expect(h.ledger.get('B')?.amount).toBe(-8)
 })
 it('propagates a mid-transaction failure and can retry without a one-sided transfer',async()=>{
  h.failSecond=true;await expect(settleWeeklyWinnings(input)).rejects.toThrow('forced database failure')
  expect(h.ledger.size).toBe(0)
  h.failSecond=false;h.writes=0;await settleWeeklyWinnings(input)
  expect(h.ledger.get('A')?.amount).toBe(8);expect(h.ledger.get('B')?.amount).toBe(-8)
 })
 it('refuses to replace an older-policy weekly record',async()=>{
  h.ledger.set('A',{rosterId:'A',amount:100,source:'weekly_settlement'})
  await expect(settleWeeklyWinnings(input)).rejects.toThrow('POLICY_REVIEW_REQUIRED')
  expect(h.ledger.get('A')?.amount).toBe(100);expect(h.writes).toBe(0)
 })
 it('uses 60 for the NFL bashing line even when the old template has 30',async()=>{
  h.snapshot={rules:{bashingThreshold:60,maulingThreshold:60},winnings:{policy:'beta_2025',openingByRoster:{A:20,B:30}},teams:[{rosterId:'A',status:'Survivor'},{rosterId:'B',status:'Survivor'}]}
  h.results.mockResolvedValue([{matchupId:'m',homeRosterId:'A',awayRosterId:'B',homeScore:149.99,awayScore:90,final:true}])
  await settleWeeklyWinnings(input);expect(h.ledger.get('A')?.amount).toBe(2);expect(h.ledger.get('B')?.amount).toBe(0)
 })
})
