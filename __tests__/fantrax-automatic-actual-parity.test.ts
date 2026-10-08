// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest'
const db=vi.hoisted(()=>({league:{findUnique:vi.fn()},leaguePlayerWeeklyScore:{findMany:vi.fn()},playerIdentityMap:{findMany:vi.fn()},playerGameStat:{findMany:vi.fn()},sportsDataCache:{upsert:vi.fn(),findMany:vi.fn().mockResolvedValue([]),findUnique:vi.fn().mockResolvedValue(null)}}))
vi.mock('@/lib/prisma',()=>({prisma:db}))
vi.mock('@/lib/redraft/ncaafGameLogIdBridge',()=>({bridgeNcaafRosterIdsToCfbdIds:vi.fn().mockResolvedValue({cfbdIds:['cfbd'],rosterIdFor:()=> 'arnold'})}))
vi.mock('@/lib/redraft/importedNcaafScoring',()=>({importedNcaafScoring:()=>({categories:[],overrides:{}})}))
vi.mock('@/lib/redraft/scoringEngine',()=>({scoreStatsWithCategories:(_c:unknown,s:Record<string,number>)=>s.pass_yds*.04}))
import {reconcileFantraxActuals} from '../lib/import-os/collector/reconcileFantraxActuals'
const info:any={seasonYear:2026,scoringPeriods:[{number:4,startDate:'2026-09-22',endDate:'2026-09-29'},{number:5,startDate:'2026-09-29',endDate:'2026-10-06'},{number:6,startDate:'2026-10-06',endDate:'2026-10-13'}]}
beforeEach(()=>{vi.clearAllMocks();db.league.findUnique.mockResolvedValue({platform:'fantrax',platformLeagueId:'snapshot',season:2026,sport:'NCAAF',settings:{}});db.leaguePlayerWeeklyScore.findMany.mockResolvedValue([{playerId:'arnold',points:6.88,rosterId:7,isStarter:true},{playerId:'unknown',points:0,rosterId:7,isStarter:true}]);db.playerIdentityMap.findMany.mockResolvedValue([{fantraxId:'arnold',canonicalName:'Jackson Arnold',position:'QB'}]);db.playerGameStat.findMany.mockResolvedValue([{playerId:'cfbd',gameId:'game',normalizedStatMap:{'passing.YDS':177},source:'cfbd-weekly'}]);db.sportsDataCache.upsert.mockResolvedValue({})})
describe('automatic Fantrax source parity sidecar',()=>{
 it('explains reviewed differences while preserving the original calculated score',async()=>{
  db.sportsDataCache.findUnique.mockResolvedValueOnce({data:{reviews:[{playerId:'arnold',gameId:'game',kind:'official_box_score',sourceUrl:'https://school.edu/boxscore/1',reviewedAt:'2026-10-07',changes:[{key:'passing.YDS',before:177,after:172}]}]}})
  await reconcileFantraxActuals('league',info,new Date('2026-10-07'))
  const row=db.sportsDataCache.upsert.mock.calls[0]![0].create.data.rows[0]
  expect(row).toMatchObject({status:'discrepancy',calculatedPoints:7.08,points:6.88,requiresReview:false,resolution:{reviewedPoints:6.88}})
 })
 it('records discrepancies and missing stats separately, without score writes',async()=>{const result=await reconcileFantraxActuals('league',info,new Date('2026-10-07'));expect(result).toEqual({compared:2,discrepancies:2,gaps:2});expect(db.sportsDataCache.upsert).toHaveBeenCalledTimes(2);const data=db.sportsDataCache.upsert.mock.calls[0]![0].create.data;expect(data.rows).toEqual(expect.arrayContaining([expect.objectContaining({playerId:'arnold',points:6.88,calculatedPoints:7.08,delta:.2,status:'discrepancy'}),expect.objectContaining({playerId:'unknown',calculatedPoints:null,status:'missing_calculation'})]));expect(db.leaguePlayerWeeklyScore.findMany.mock.calls[0]![0].where).toMatchObject({leagueId:'snapshot',seasonYear:2026,source:'fantrax',isStarter:true});expect(data.period).toBe(5)})
 it('does not claim parity when source actuals are absent',async()=>{db.leaguePlayerWeeklyScore.findMany.mockResolvedValue([]);expect(await reconcileFantraxActuals('league',info,new Date('2026-10-07'))).toEqual({compared:0,discrepancies:0,gaps:0});expect(db.sportsDataCache.upsert).not.toHaveBeenCalled()})
 it('does not compare a different season or another platform',async()=>{db.league.findUnique.mockResolvedValue({platform:'sleeper',season:2026});await reconcileFantraxActuals('league',info);expect(db.leaguePlayerWeeklyScore.findMany).not.toHaveBeenCalled()})
})
