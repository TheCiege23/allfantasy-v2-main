// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({db:{league:{findUnique:vi.fn()},fantraxLeague:{findUnique:vi.fn()},leagueTeam:{findMany:vi.fn()},leaguePlayerWeeklyScore:{findMany:vi.fn(),findUnique:vi.fn(),upsert:vi.fn()},sportsDataCache:{create:vi.fn(),upsert:vi.fn()},$executeRaw:vi.fn(),$transaction:vi.fn()},info:vi.fn(),rosters:vi.fn(),scores:vi.fn()}))
vi.mock('@/lib/prisma',()=>({prisma:mocks.db}))
vi.mock('@/lib/league-import/fantrax/fantraxApi',()=>({getFantraxLeagueInfo:mocks.info,getFantraxTeamRosters:mocks.rosters,getFantraxMatchupScores:mocks.scores}))
import {importFantraxBrowserActuals} from '../lib/import-os/collector/fantraxBrowserActuals'
const csv='"ID","Player","Status","Opponent","Fantasy Points","YDS-Pa","TD-Pa","YDS-Ru","TDRu","REC","YDS-RC","TD-Rc"\n"player","Player","Act","Bye","0","0","0","0","0","0","0","0"'
const manifest={leagueId:'league',season:2026,exports:[{period:4,sourceTeamId:'team',csv}]}
beforeEach(()=>{vi.resetAllMocks();const db=mocks.db;db.league.findUnique.mockResolvedValue({userId:'owner',platform:'fantrax',platformLeagueId:'snapshot',season:2026,sport:'NCAAF'});db.fantraxLeague.findUnique.mockResolvedValue({appUserId:'owner',sourceLeagueId:'source'});db.leagueTeam.findMany.mockResolvedValue([{externalId:'7',teamName:'Team'}]);db.leaguePlayerWeeklyScore.findMany.mockResolvedValue([]);db.leaguePlayerWeeklyScore.findUnique.mockResolvedValue(null);db.$transaction.mockImplementation(fn=>fn(db));mocks.info.mockResolvedValue({ok:true,data:{seasonYear:2026,scoringPeriods:[{number:4,endDate:'2026-09-29'}]}});mocks.rosters.mockResolvedValue({ok:true,data:{team:{teamName:'Team',rosterItems:[{id:'player',status:'ACTIVE',position:'RB'}]}}});mocks.scores.mockResolvedValue({ok:true,data:{period:4,matchups:[{home:{teamId:'team',score:0,gamesPlayed:1},away:{teamId:'other',score:1,gamesPlayed:1}}]}})})
describe('browser actual import boundaries',()=>{
 it('defaults to validation with no mutation',async()=>{expect(await importFantraxBrowserActuals('owner',manifest)).toMatchObject({mode:'dry-run',verifiedRows:1,plannedWrites:1,written:0});expect(mocks.db.$transaction).not.toHaveBeenCalled()})
 it('rejects another owner before source calls',async()=>{await expect(importFantraxBrowserActuals('other',manifest)).rejects.toThrow();expect(mocks.info).not.toHaveBeenCalled()})
 it('backs up under lock before league-scoped score writes',async()=>{expect(await importFantraxBrowserActuals('owner',{...manifest,apply:true})).toMatchObject({written:1});expect(mocks.db.sportsDataCache.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.db.leaguePlayerWeeklyScore.upsert.mock.invocationCallOrder[0]!);expect(mocks.db.leaguePlayerWeeklyScore.upsert.mock.calls[0][0].create).toMatchObject({leagueId:'snapshot',seasonYear:2026,week:4,source:'fantrax',points:0,rosterId:7})})
 it('refuses mismatched source totals before the transaction',async()=>{mocks.scores.mockResolvedValue({ok:true,data:{period:4,matchups:[{home:{teamId:'team',score:10,gamesPlayed:1}}]}});await expect(importFantraxBrowserActuals('owner',{...manifest,apply:true})).rejects.toThrow();expect(mocks.db.$transaction).not.toHaveBeenCalled()})
 it('preserves identical finalized rows on repeated imports',async()=>{
  const prior={week:4,playerId:'player',points:0,rosterId:7,isStarter:true,source:'fantrax',isFinalized:true}
  mocks.db.leaguePlayerWeeklyScore.findMany.mockResolvedValue([prior]);mocks.db.leaguePlayerWeeklyScore.findUnique.mockResolvedValue(prior)
  expect(await importFantraxBrowserActuals('owner',{...manifest,apply:true})).toMatchObject({plannedWrites:0,written:0,unchanged:1})
  expect(mocks.db.leaguePlayerWeeklyScore.upsert).not.toHaveBeenCalled()
 })
 it('rejects changed finalized rows before writing',async()=>{
  mocks.db.leaguePlayerWeeklyScore.findMany.mockResolvedValue([{week:4,playerId:'player',points:1,rosterId:7,isStarter:true,source:'fantrax',isFinalized:true}])
  await expect(importFantraxBrowserActuals('owner',{...manifest,apply:true})).rejects.toThrow('Finalized')
  expect(mocks.db.$transaction).not.toHaveBeenCalled()
 })
 it('rejects multiple periods and duplicate team exports',async()=>{await expect(importFantraxBrowserActuals('owner',{...manifest,exports:[...manifest.exports,{...manifest.exports[0]!,period:5}]})).rejects.toThrow();await expect(importFantraxBrowserActuals('owner',{...manifest,exports:[...manifest.exports,...manifest.exports]})).rejects.toThrow('Duplicate')})
})
