import {describe,it,expect,vi} from 'vitest'
import {captureSpecialtyBasis} from '@/lib/draft-archive/specialtyBasis'
describe('specialist draft-start capture',()=>{
 it('does not read specialist tables for a standard draft',async()=>{
  const value=await captureSpecialtyBasis({} as never,{season:2026},{leagueId:'l'},new Date('2026-08-01'))
  expect(value.college).toBeNull();expect(value.salary).toBeNull();expect(value.dispersal).toBeNull()
 })
 it('freezes college identity flags and round rules without matching by name',async()=>{
  const read=vi.fn().mockResolvedValue([{id:'devy-id',cfbdId:'college-id',sleeperId:null,position:'WR',graduatedToNFL:false}])
  const value=await captureSpecialtyBasis({devyPlayer:{findMany:read}} as never,{season:2026},{leagueId:'l',c2cConfig:{enabled:true,collegeRounds:[1,3]}},new Date('2026-08-01'))
  expect(value.college).toMatchObject({state:'captured',mode:'c2c',rounds:[1,3],players:[{playerId:'devy-id',graduated:false}]})
  expect(read.mock.calls[0][0].select).not.toHaveProperty('name')
 })
 it('bounds contract and college sources and scopes ledgers to the exact year and league',async()=>{
  const ledger=vi.fn().mockResolvedValue([]),contracts=vi.fn().mockResolvedValue([]),college=vi.fn().mockResolvedValue(Array(5001).fill({}))
  const value=await captureSpecialtyBasis({salaryCapTeamLedger:{findMany:ledger},playerContract:{findMany:contracts},devyPlayer:{findMany:college}} as never,{season:2026,leagueVariant:'salary_cap'},{leagueId:'l',devyConfig:{enabled:true,devyRounds:[1]}},new Date('2026-08-01'))
  expect(value.college).toEqual({state:'unavailable'});expect(ledger.mock.calls[0][0].where).toEqual({leagueId:'l',capYear:2026});expect(contracts.mock.calls[0][0].where).toEqual({leagueId:'l',status:'active'})
 })
})
