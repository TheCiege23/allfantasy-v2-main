/** Persistent daily QA: real upcoming NBA games and players, uncontactable managers only. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'

assert.equal(process.env.PIRATE_DAILY_REHEARSAL_CREATE, '1', 'Explicit opt-in required')
const stage = dotenv.parse(fs.readFileSync(process.env.PIRATE_STAGING_ENV || 'G:/allfantasy-v2-main/.env.staging'))
assert(/^ep-winter-salad-/.test(new URL(stage.DATABASE_URL).hostname), 'Separate staging required')
Object.assign(process.env, stage, { NODE_ENV: 'test', DIRECT_URL: stage.DATABASE_URL })
const db = new PrismaClient({ datasources: { db: { url: stage.DATABASE_URL } } })
;(globalThis as unknown as { prisma: PrismaClient }).prisma = db
const tag = `pirate-capture-live-daily-${randomUUID().slice(0, 8)}`
const users: string[] = []
let leagueId: string | undefined
let complete = false
async function run() {
  assert.equal(await db.league.count({ where: { tenantId: { startsWith: 'pirate-capture-live-daily-' },
    settings: { path: ['pirate_daily_rehearsal'], equals: true } } }), 0, 'Existing daily pilot must be inspected, not duplicated')
  const [{ dailySportWeekForInstant, resolveDailySportWeekWindow }, { daysInWindow, writeDailyLineupForSave },
    { getLiveScoresForSport }, { buildWeekKickoffMap, normalizeLockTeam }] = await Promise.all([
    import('../lib/season-week/dailySportSeasonStarts'), import('../lib/redraft/dailyLineups'),
    import('../lib/sports-live-scores-service'), import('../lib/redraft/lineupLock'),
  ])
  const week = dailySportWeekForInstant('NBA', 2026, new Date())
  assert(week)
  const window = resolveDailySportWeekWindow('NBA', 2026, week)
  assert(window)
  const days = daysInWindow(window).map(day => day.toISOString().slice(0, 10))
  const slate = await getLiveScoresForSport({ sport: 'NBA', forceRefresh: true, espnDates: days.map(day => day.replaceAll('-', '')) })
  assert(slate.refreshed && slate.source === 'espn_live' && slate.scores.length > 0, 'A genuine whole-week scoreboard is required')
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  const schedule = await buildWeekKickoffMap(db, { sport: 'NBA', season: 2026, week })
  assert.equal(schedule.warnings.length, 0)
  const starts = [...schedule.byTeamDay?.entries() ?? []].flatMap(([team, byDay]) => {
    const at = byDay.get(today)
    return at ? [{team,at}] : []
  }).sort((a,b) => +a.at - +b.at)
  assert(starts.length >= 4 && +starts[0].at - Date.now() > 15 * 60000, 'Prepare before actual daily evidence windows')
  const candidates = await db.sportsPlayer.findMany({ where: { sport:'NBA', source:'rolling_insights', status:'ACT',
    fetchedAt:{gt:new Date(Date.now()-3600000)}, position:{in:['PG','SG','SF','PF','C']} }, orderBy:{name:'asc'} })
  const injuries = await db.sportsInjury.findMany({where:{sport:'NBA',expiresAt:{gt:new Date()}},select:{playerName:true}})
  const injured = new Set(injuries.map(p=>p.playerName.toLowerCase()))
  const active = candidates.filter(p=>!injured.has(p.name.toLowerCase()) && starts.some(s=>s.team===normalizeLockTeam('NBA',p.team)))
    .slice(0,8).map(p=>({...p,id:p.externalId}))
  assert.equal(active.length,8,'Eight genuine healthy-designated current players with games today are required')
  const { backfillIdentityMapForSport } = await import('../lib/sports-data/multiSportIdentityMap')
  const identity = await backfillIdentityMapForSport('NBA')
  assert.equal(identity.errors.length,0,'Canonical NBA identity backfill must succeed')
  assert(await db.playerIdentityMap.count({where:{sport:'NBA',rollingInsightsId:{in:active.map(p=>p.externalId)}}}) >= 8,'Canonical game-log identities required')
  const [{createActorContext},{createStagingLeagueFixture}] = await Promise.all([import('../lib/domain/actorContext'),import('../lib/domain/stagingLeagueFixture')])
  for(let i=0;i<4;i++) users.push((await db.appUser.create({data:{email:`${tag}-${i}@example.invalid`,username:`${tag}_${i}`,displayName:`Daily QA ${i+1}`}})).id)
  const actor = createActorContext({userId:users[0],tenantId:tag,actorLabel:'Pirate NBA daily pilot'})
  assert(actor.ok)
  const league = await createStagingLeagueFixture(db,actor.value,{name:'Pirate NBA daily QA — synthetic managers',platform:'manual',platformLeagueId:tag,
    sport:'NBA',season:2026,leagueType:'pirate',leagueVariant:'pirate',leagueSize:4,rosterSize:3,irSlots:1,lifecycleState:'in_season',settings:{
      pirate_live_rehearsal:true,pirate_daily_rehearsal:true,starter_slots:{UTIL:1,BN:2,IL:1},nba_roster_config:{slots:{UTIL:1,BN:2,IL:1}},
      sportConfig:{lineupLockType:'daily',dailyLineupsEnabled:true},pirate:{protectionLimit:3,claimHours:24,selectionHours:24,overflowGraceHours:24}}})
  leagueId=league.id
  const season=await db.redraftSeason.create({data:{leagueId,sport:'NBA',season:2026,status:'active',currentWeek:week,totalWeeks:20,playoffStartWeek:21}})
  const rosters: string[]=[]
  for(let i=0;i<4;i++) {
    const pair=active.slice(i*2,i*2+2)
    const roster=await db.redraftRoster.create({data:{leagueId,seasonId:season.id,ownerId:users[i],ownerName:`Daily QA ${i+1}`}})
    rosters.push(roster.id)
    const section=(j:number)=>i===0&&j===0?'starters':i===2&&j===0?'ir':'bench'
    for(let j=0;j<2;j++) await db.redraftRosterPlayer.create({data:{rosterId:roster.id,playerId:pair[j].id,playerName:pair[j].name,
      position:pair[j].position!,team:pair[j].team,sport:'NBA',slotType:section(j)==='starters'?'UTIL':section(j)==='ir'?'IL':'BENCH'}})
    const sections={starters:[] as Array<{id:string;position:string;slotIndex:number}>,bench:[] as Array<{id:string;position:string}>,ir:[] as Array<{id:string;position:string}>}
    pair.forEach((p,j)=>{const row={id:p.id,position:p.position!};if(section(j)==='starters')sections.starters.push({...row,slotIndex:0});else sections[section(j) as 'bench'|'ir'].push(row)})
    const legacy=await db.roster.create({data:{leagueId,platformUserId:users[i],redraftRosterId:roster.id,playerData:{players:pair.map(p=>p.id),starters:sections.starters.map(p=>p.id),lineup_sections:sections}}})
    await db.afRosterLineupAssignment.createMany({data:pair.map((p,j)=>({leagueId:leagueId!,rosterId:legacy.id,season:2026,week,playerId:p.id,section:section(j),slotIndex:0}))})
    // Save only today and future days. Earlier days do not get reconstructed proof.
    await db.$transaction(tx=>writeDailyLineupForSave(tx,{leagueId:leagueId!,redraftRosterId:roster.id,sport:'NBA',season:2026,week,source:'qa-setup'}))
    await db.pirateProtectionSet.create({data:{leagueId,seasonId:season.id,week,rosterId:roster.id,playerIds:[pair[1].id],lockAt:starts[0].at}})
  }
  for(const i of [0,2])await db.redraftMatchup.create({data:{leagueId,seasonId:season.id,week,homeRosterId:rosters[i],awayRosterId:rosters[i+1],status:'scheduled'}})
  const report={preparedAt:new Date().toISOString(),leagueId,seasonId:season.id,tenantId:tag,sport:'NBA',week,scoringDay:today,daysSaved:days.filter(d=>d>=today),
    firstGameAt:starts[0].at.toISOString(),lastGameAt:starts.at(-1)!.at.toISOString(),realPlayers:active.map(p=>({id:p.id,name:p.name,position:p.position,team:p.team})),
    rosterIds:rosters,cases:['Legal daily control','Empty starter with on-roster repair','Reserve activation witness plus bench','Empty starter, second roster control'],
    managers:'Four uncontactable example.invalid accounts; no human participants',status:'Prepared before real locks; observations and final outcomes pending',expiresAt:'2026-11-07T12:00:00Z'}
  fs.writeFileSync(process.env.PIRATE_DAILY_REHEARSAL_REPORT||'docs/pirate-validation/daily-live-staging.json',JSON.stringify(report,null,2)+'\n')
  complete=true
  console.log(JSON.stringify(report,null,2))
}
run().catch(e=>{console.error('Daily pilot setup failed:',e.name==='AssertionError'?e.message:e.code||e.name);process.exitCode=1}).finally(async()=>{
  if(!complete){if(leagueId)await db.league.deleteMany({where:{id:leagueId,tenantId:tag}});await db.appUser.deleteMany({where:{id:{in:users}}});await db.tenant.deleteMany({where:{id:tag}})}
  await db.$disconnect()
})
