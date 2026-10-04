import {beforeEach,it,expect,vi} from 'vitest'
const db=vi.hoisted(()=>({redraftSeason:{findUnique:vi.fn(),update:vi.fn()},league:{findUnique:vi.fn(),update:vi.fn()},roster:{findMany:vi.fn()},teamWeekResult:{findMany:vi.fn()},redraftRoster:{findMany:vi.fn()},$transaction:vi.fn()}))
vi.mock('@/lib/prisma',()=>({prisma:db}))
vi.mock('@/lib/events',()=>({getPlatformEvents:()=>({emit:vi.fn()}),EVENT:{CHAMPION_CROWNED:'champion',SEASON_COMPLETED:'complete'}}))
vi.mock('@/lib/redraft/standingsEngine',()=>({updateStandings:vi.fn()}))
import {finalizeRotoSeason} from '@/lib/redraft/offseason/finalizeRotoSeason'
beforeEach(()=>{
 vi.clearAllMocks()
 db.redraftSeason.findUnique.mockResolvedValue({id:'s',leagueId:'l',season:2027,totalWeeks:23,status:'regular_season_complete',league:{settings:{scoring_mode:'roto'}}})
 db.roster.findMany.mockResolvedValue([{id:'generic-a'},{id:'generic-b'}])
 db.teamWeekResult.findMany.mockResolvedValue([{rosterId:'generic-a'},{rosterId:'generic-b'}])
 db.redraftRoster.findMany.mockResolvedValue([{id:'native-a',teamName:'Aces',pointsFor:19},{id:'native-b',teamName:'Bears',pointsFor:11}])
 db.league.findUnique.mockResolvedValue({lifecycleState:'in_season',settings:{scoring_mode:'roto',existing:'preserved'}})
 db.$transaction.mockImplementation(async(fn)=>fn(db))
})
it('crowns the cumulative winner and saves an idempotent result without creating a bracket',async()=>{
 const r=await finalizeRotoSeason('s')
 expect(r).toMatchObject({ok:true,format:'roto',championRosterId:'native-a',runnerUpRosterId:'native-b',alreadyFinalized:false})
 expect(db.redraftSeason.update).toHaveBeenCalledWith({where:{id:'s'},data:{status:'complete'}})
 expect(db.league.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({lifecycleState:'completed'})}))
 expect(db.league.update).toHaveBeenCalledWith(expect.objectContaining({data:{settings:expect.objectContaining({existing:'preserved',roto_season_results:{'2027':expect.objectContaining({championRosterId:'native-a'})}})}}))
 if(r.ok) {
  db.redraftSeason.findUnique.mockResolvedValue({season:2027,status:'complete',league:{settings:{scoring_mode:'roto',roto_season_results:{'2027':{championRosterId:r.championRosterId,runnerUpRosterId:r.runnerUpRosterId,finalStandings:r.finalStandings}}}}})
  expect(await finalizeRotoSeason('s')).toMatchObject({ok:true,alreadyFinalized:true,championRosterId:'native-a'})
  expect(db.$transaction).toHaveBeenCalledTimes(1)
 }
})
it('holds an incompletely scored final period',async()=>{
 db.teamWeekResult.findMany.mockResolvedValue([{rosterId:'generic-a'}])
 expect(await finalizeRotoSeason('s')).toMatchObject({ok:false,code:'FINAL_ROUND_INCOMPLETE'})
 expect(db.$transaction).not.toHaveBeenCalled()
})
it('does not pick a tied champion by roster id',async()=>{
 db.redraftRoster.findMany.mockResolvedValue([{id:'native-a',pointsFor:15},{id:'native-b',pointsFor:15}])
 expect(await finalizeRotoSeason('s')).toMatchObject({ok:false,code:'NO_WINNER'})
 expect(db.$transaction).not.toHaveBeenCalled()
})

it('accepts an authorized caller choosing among tied leaders and rejects a lower team',async()=>{
 db.redraftRoster.findMany.mockResolvedValue([{id:'native-a',teamName:'Aces',pointsFor:15},{id:'native-b',teamName:'Bears',pointsFor:15},{id:'native-c',teamName:'Last',pointsFor:10}])
 expect(await finalizeRotoSeason('s','commish','native-c')).toMatchObject({ok:false,code:'NO_WINNER'})
 expect(await finalizeRotoSeason('s','commish','native-b')).toMatchObject({ok:true,championRosterId:'native-b'})
})
