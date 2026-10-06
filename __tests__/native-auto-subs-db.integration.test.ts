// @vitest-environment node
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest'
vi.mock('@/lib/notifications/NotificationDispatcher',()=>({dispatchNotification:vi.fn(async()=>{})}))
vi.mock('@/lib/core-app/currentSleeperRoster',()=>({currentSleeperRoster:vi.fn(async()=>null)}))
import {currentSleeperRoster} from '@/lib/core-app/currentSleeperRoster'
import {getMyTeamData} from '@/lib/core-app/myTeam'
import {prisma} from '@/lib/prisma'
import {runNativeAutoSubsForLeague} from '@/lib/core-app/nativeAutoSubs'
import {nativeAutoSubsKey} from '@/lib/core-app/nativeAutoSubsPolicy'
import {persistRosterLineupWithEngine} from '@/lib/roster-lineup-engine/lineupService'
import {applyStarterSwap} from '@/lib/roster/starterSwap'
import {saveTeamPreference,readTeamPreference} from '@/lib/core-app/teamPreferenceStore'
const safe=process.env.TEAM_WORKSPACE_DB_SPECS==='1'&&/^postgresql:\/\/postgres@127\.0\.0\.1:5446\//.test(process.env.DATABASE_URL??'')
const suffix=String(Date.now()),user=`autosub-db-${suffix}`,leagueId=`autosub-league-${suffix}`,rosterId=`autosub-roster-${suffix}`
const ids=['99555001','99555002'],key=nativeAutoSubsKey(leagueId,rosterId,2026,5)
describe.skipIf(!safe)('native AutoSubs real local transaction',()=>{
 beforeAll(async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-08T16:00:00Z'))
  await prisma.appUser.create({data:{id:user,email:`${user}@tests.invalid`,username:user}})
  await prisma.league.create({data:{id:leagueId,userId:user,platform:'native',platformLeagueId:leagueId,sport:'NFL',season:2026,status:'in_season',lifecycleState:'in_season',starters:['RB'],settings:{currentWeek:5,nativeAutoSubsEnabled:true,nfl_roster_config:{slots:{RB:1,BN:1}}}}})
  await prisma.roster.create({data:{id:rosterId,leagueId,platformUserId:user,playerData:{starters:[ids[0]],players:ids,lineup_sections:{starters:[{id:ids[0],position:'RB'}],bench:[{id:ids[1],position:'RB'}],ir:[],taxi:[],devy:[]}}}})
  for(const [i,id] of ids.entries())await prisma.sportsPlayer.create({data:{sport:'NFL',externalId:`sleeper:${id}`,sleeperId:id,name:`QA native ${i}`,position:'RB',team:`QA${i}`,source:'sleeper',status:i?'ACTIVE':'OUT',fetchedAt:new Date(),expiresAt:new Date(Date.now()+3600000)}})
  await prisma.sportsGame.create({data:{sport:'NFL',externalId:`qa-${suffix}`,source:'sleeper',homeTeam:'QA0',awayTeam:'QA1',season:2026,week:5,seasonType:'regular',startTime:new Date(Date.now()+3600000),expiresAt:new Date(Date.now()+7200000)}})
  await saveTeamPreference(user,key,0,{enabled:true,starters:[ids[0]],backups:{0:ids[1]}})
 })
 afterAll(async()=>{
  await prisma.automationAuditLog.deleteMany({where:{leagueId}})
  await prisma.league.deleteMany({where:{id:{in:[leagueId,leagueId+'-imported']}}})
  await prisma.userProfile.deleteMany({where:{userId:user}})
  await prisma.appUser.deleteMany({where:{id:user}})
  await prisma.sportsPlayer.deleteMany({where:{sport:'NFL',sleeperId:{in:ids}}})
  await prisma.sportsGame.deleteMany({where:{externalId:`qa-${suffix}`}})
  vi.useRealTimers()
 })
 it('commits the lineup, consumed assignment and audit together, then never repeats',async()=>{
  const result=await runNativeAutoSubsForLeague(leagueId,Date.now()+30000)
  expect(result).toEqual([{rosterId,applied:true,reason:'saved_and_verified'}])
  const roster=await prisma.roster.findUnique({where:{id:rosterId}})
  expect(roster?.playerData).toMatchObject({starters:[ids[1]],lineup_sections:{starters:[{id:ids[1]}],bench:[{id:ids[0]}]}})
  expect(await readTeamPreference(user,key)).toMatchObject({version:2,enabled:false,starters:[ids[1]],backups:{}})
  expect(await prisma.automationAuditLog.count({where:{leagueId,action:'native_autosub.applied'}})).toBe(1)
  expect(await runNativeAutoSubsForLeague(leagueId)).toEqual([])
  expect(await prisma.automationAuditLog.count({where:{leagueId,action:'native_autosub.applied'}})).toBe(1)
 })
 it('rolls back an authorization advance when the owner compare-and-swap fails',async()=>{
  const roster=await prisma.roster.findUniqueOrThrow({where:{id:rosterId}})
  const assignment=await readTeamPreference(user,key)
  const result=await persistRosterLineupWithEngine({leagueId,rosterId,actorUserId:user,expectedOwnerUserId:'foreign-owner',season:2026,week:5,source:'system',expectedStarters:[ids[1]],nextPlayerData:applyStarterSwap(roster.playerData,0,ids[0]),transactionCheck:async tx=>{
   await tx.$executeRaw`UPDATE user_profiles SET core_preferences=core_preferences||jsonb_build_object(${key}::text,'{"version":999}'::jsonb) WHERE "userId"=${user}`
  },automationAudit:{id:`rollback-${suffix}`,action:'native_autosub.applied',message:'Must never commit',metadata:{}}})
  expect(result).toMatchObject({ok:false,status:409})
  expect(await readTeamPreference(user,key)).toEqual(assignment)
  expect((await prisma.roster.findUniqueOrThrow({where:{id:rosterId}})).playerData).toEqual(roster.playerData)
  expect(await prisma.automationAuditLog.findUnique({where:{id:`rollback-${suffix}`}})).toBeNull()
 })

 it('reads a saved imported roster without invoking the live provider verification path',async()=>{
  const importedId=leagueId+'-imported'
  await prisma.league.create({data:{id:importedId,userId:user,platform:'sleeper',platformLeagueId:importedId,sport:'NFL',season:2026,status:'in_season',lifecycleState:'in_season',starters:['RB'],settings:{leg:5},lastSyncedAt:new Date()}})
  await prisma.leagueTeam.create({data:{leagueId:importedId,externalId:'1',platformUserId:user,claimedByUserId:user,ownerName:'Local QA',teamName:'Saved imported team'}})
  await prisma.roster.create({data:{leagueId:importedId,platformUserId:user,playerData:{starters:[ids[0]],players:ids}}})
  vi.mocked(currentSleeperRoster).mockClear()
  const saved=await getMyTeamData(importedId,user,null,{savedRosterOnly:true})
  expect(saved?.workspaceScope?.season).toBe(2026)
  expect(saved?.starters.available).toBe(true)
  expect(currentSleeperRoster).not.toHaveBeenCalled()
  const live=await getMyTeamData(importedId,user)
  expect(currentSleeperRoster).toHaveBeenCalledTimes(1)
  expect(live?.starters.available).toBe(false)
 })

})
