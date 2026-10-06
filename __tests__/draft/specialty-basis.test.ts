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
  expect(read.mock.calls[0][0].where).toEqual({devyEligible:true});expect(value.college).toMatchObject({valuations:[]})
 })
 it('bounds contract and college sources and scopes ledgers to the exact year and league',async()=>{
  const ledger=vi.fn().mockResolvedValue([]),contracts=vi.fn().mockResolvedValue([]),college=vi.fn().mockResolvedValue(Array(5001).fill({}))
  const value=await captureSpecialtyBasis({salaryCapTeamLedger:{findMany:ledger},salaryCapLeagueConfig:{findUnique:vi.fn().mockResolvedValue(null)},playerContract:{findMany:contracts},devyPlayer:{findMany:college}} as never,{season:2026,leagueVariant:'salary_cap'},{leagueId:'l',devyConfig:{enabled:true,devyRounds:[1]}},new Date('2026-08-01'))
  expect(value.college).toEqual({state:'unavailable'});expect(ledger.mock.calls[0][0].where).toEqual({leagueId:'l',capYear:2026});expect(contracts.mock.calls[0][0].where).toEqual({leagueId:'l',status:{in:['active','tagged','option_exercised']}})
 })
 it('freezes contemporary college estimates and excludes in-season production and prospect data updated after draft start',async()=>{
  const at=new Date('2026-08-01T00:00:00Z');vi.useFakeTimers();vi.setSystemTime(at);
  try{
   const players=vi.fn().mockResolvedValue([{id:'a',cfbdId:'cf-a',sleeperId:null,position:'WR',name:'Prospect',graduatedToNFL:false,recruitingStars:4,recruitingComposite:0.95,ppaSeasonTotal:999,statSeason:2026,draftEligibleYear:2027,updatedAt:new Date('2026-07-31')},{id:'b',cfbdId:'cf-b',sleeperId:null,position:'WR',name:'Future data',graduatedToNFL:false,recruitingStars:4,recruitingComposite:0.95,ppaSeasonTotal:999,statSeason:2026,draftEligibleYear:2027,updatedAt:new Date('2026-08-02')}]);
   const projections=vi.fn().mockResolvedValue([]);
   const value=await captureSpecialtyBasis({devyPlayer:{findMany:players},aFProjectionSnapshot:{findMany:projections}} as never,{season:2026,settings:{collegeScoringSettings:{rules:{ppr:0.5}}}},{leagueId:'l',c2cConfig:{enabled:true,collegeRounds:[1]}},at);
   const college=value.college as {valuations:Array<{computedAt:string|null;option:{scale:string;pSource:string}|null}>;collegeScoring:unknown};
   expect(college.valuations[0].option?.scale).toBe('fantasycalc-dynasty-superflex-12');expect(college.valuations[0].option?.pSource).not.toBe('production');
   expect(college.valuations[1]).toMatchObject({computedAt:null,option:null});expect(college.collegeScoring).toEqual({rules:{ppr:0.5}});
   expect(projections.mock.calls[0][0].where).toMatchObject({sport:'NCAAF',season:2026,computedAt:{lte:at},playerId:{in:['cf-a','cf-b']}});
  }finally{vi.useRealTimers();}
 })

})
