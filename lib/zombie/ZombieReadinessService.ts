import { prisma } from '@/lib/prisma'
import { resolveDraftPoolCacheContext } from '@/lib/draft-room/ensureDraftPoolReady'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { validateRedraftLineup } from '@/lib/redraft/lineupValidation'
import { loadWeekLineups, weekSlotType } from '@/lib/redraft/weekLineupSlots'
import { dailySlotFor, dayKey, daysDecidedBySave, isDailyLineupScoringEnabled, loadDailyLineups } from '@/lib/redraft/dailyLineups'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { registeredSeatReadiness, savedPoolCoverage, settlementReadiness, type ReadinessCheck, type ZombieLeagueReadiness, type ZombieReadinessReport } from './readiness'

export class ZombieReadinessError extends Error {}
export async function getZombieReadiness(scope: { leagueId?: string; universeId?: string }, actor: string, now = new Date()): Promise<ZombieReadinessReport> {
  let ids: string[]
  if(scope.universeId) {
    const universe=await prisma.zombieUniverse.findUnique({where:{id:scope.universeId}})
    if(!universe) throw new ZombieReadinessError('NOT_FOUND')
    if((universe.commissionedByUserId??universe.createdByUserId)!==actor) throw new ZombieReadinessError('OWNER_REQUIRED')
    const latest=await prisma.zombieLeague.aggregate({where:{universeId:universe.id},_max:{season:true}})
    const rows=await prisma.zombieLeague.findMany({where:{universeId:universe.id,season:latest._max.season??0},orderBy:{leagueId:'asc'},select:{leagueId:true},take:25})
    if(rows.length>24) throw new ZombieReadinessError('TOO_MANY_LEAGUES')
    ids=rows.map(r=>r.leagueId)
  } else {
    const league=await prisma.league.findUnique({where:{id:scope.leagueId??''},select:{userId:true}})
    if(!league) throw new ZombieReadinessError('NOT_FOUND')
    if(league.userId!==actor) throw new ZombieReadinessError('OWNER_REQUIRED')
    ids=[scope.leagueId!]
  }
  const leagues: ZombieLeagueReadiness[]=[]
  // Bound concurrency to avoid exhausting DB connections for large universes.
  for(const id of ids) leagues.push(await leagueReadiness(id,now))
  return {checkedAt:now.toISOString(),scope:scope.universeId?'universe':'league',leagues}
}
async function leagueReadiness(leagueId: string, now: Date): Promise<ZombieLeagueReadiness> {
  const z=await prisma.zombieLeague.findUnique({where:{leagueId},include:{league:{include:{rosters:true}}}})
  if(!z) throw new ZombieReadinessError('NOT_FOUND')
  const {league}=z, base='/league/'+encodeURIComponent(leagueId)
  const [users,draft,native,resolutions]=await Promise.all([
    prisma.appUser.findMany({where:{id:{in:league.rosters.map(r=>r.platformUserId)}},select:{id:true}}),
    prisma.draftSession.findFirst({where:{leagueId},orderBy:{createdAt:'desc'},select:{status:true}}),
    prisma.redraftSeason.findUnique({where:{leagueId_season:{leagueId,season:z.season}}}),
    prisma.zombieWeeklyResolution.findMany({where:{zombieLeagueId:z.id},select:{week:true,status:true,requiresStatCorrection:true}}),
  ])
  const seats=registeredSeatReadiness(league.rosters.map(r=>r.platformUserId),users.map(u=>u.id),z.teamCount)
  const checks:ReadinessCheck[]=[{id:'managers',label:'Registered managers',status:seats.ready?'ready':'attention',
    detail:seats.registered+' / '+z.teamCount+' registered; '+seats.missing+' seats to fill.'+(seats.duplicate?' Duplicate ownership needs review.':''),href:base},
    {id:'draft',label:'Draft',status:draft?.status==='completed'?'ready':draft?.status==='pre_draft'?'waiting':draft?'attention':'unknown',
      detail:draft?.status==='completed'?'Draft completed.':draft?.status==='pre_draft'?'Draft remains unstarted.':draft?'Draft status: '+draft.status+'.':'No draft found.',href:base+'/draft'}]
  if(draft?.status!=='completed') checks.push({id:'lineups',label:'Lineups',status:'waiting',detail:'Checked after the draft finishes.',href:base})
  else if(!native) checks.push({id:'lineups',label:'Lineups',status:'unknown',detail:'Native season is not initialized.',href:base})
  else {
    const week=Math.max(1,native.currentWeek)
    const rosters=await prisma.redraftRoster.findMany({where:{seasonId:native.id},include:{players:{where:{droppedAt:null}}}})
    const config=resolveRedraftRosterConfig(league.sport,league.settings)
    const weekly=await loadWeekLineups(prisma,{redraftRosterIds:rosters.map(r=>r.id),season:z.season,week})
    const isDaily=isDailyLineupScoringEnabled(league.settings,league.sport)
    const window=isDaily?resolveDailySportWeekWindow(league.sport,z.season,week):null
    const day=window?daysDecidedBySave(window,now)[0]:undefined
    const daily=window&&day?await loadDailyLineups(prisma,{redraftRosterIds:rosters.map(r=>r.id),window}):null
    let fixes=0,warnings=0
    for(const roster of rosters) {
      const result=validateRedraftLineup({sport:league.sport,week,rosterConfig:config,players:roster.players.map(p=>({...p,
        slotType:(day&&daily?dailySlotFor(daily,roster.id,p.playerId,day):null)??weekSlotType(p,weekly)}))})
      if(!result.ok) fixes++
      warnings+=result.warningCount
    }
    const missing=league.rosters.filter(r=>!rosters.some(rr=>rr.ownerId===r.platformUserId)).length
    checks.push({id:'lineups',label:'Lineups',status:isDaily&&!day?'unknown':fixes||missing||warnings?'attention':'ready',
      detail:isDaily&&!day?'No current or upcoming scoring day is available for this week.':
        'Week '+week+(day?' · '+dayKey(day):'')+': '+fixes+' teams need fixes, '+missing+' missing rosters, '+warnings+' warnings. Recheck before each lock.',href:base})
  }
  // Exact canonical cache only: no vendor calls, rebuilds, or cross-format/roster fallback.
  const context=await resolveDraftPoolCacheContext(leagueId)
  const cached=await prisma.draftPoolCache.findUnique({where:{cacheKey:context.standardCacheKey},select:{payload:true,syncedAt:true,expiresAt:true}})
  const coverage=savedPoolCoverage(cached?.payload,league.sport), fresh=Boolean(cached&&cached.expiresAt>now)
  checks.push({id:'pool',label:'Saved draft data',status:!cached?'unknown':!fresh||!coverage.entries?'attention':'ready',
    detail:cached?'Snapshot '+cached.syncedAt.toISOString()+': '+coverage.entries+' players; '+(fresh?'cache current.':'cache expired; refresh in the draft room.'):'Open the draft room to prepare its saved player pool.',href:base+'/draft'})
  checks.push({id:'coverage',label:'Player data coverage',status:!cached?'unknown':coverage.entries>0&&fresh&&coverage.positions===coverage.entries&&coverage.stats===coverage.entries&&coverage.portraits===coverage.entries&&coverage.adp===coverage.entries?'ready':'attention',
    detail:!cached?'No saved snapshot to measure.':coverage.entries+' sampled rows: '+coverage.positions+' positions, '+coverage.stats+' numeric stat lines, '+coverage.portraits+' portrait URLs, '+coverage.adp+' market ADP values. Snapshot evidence does not verify image rendering or live scoring.',href:base+'/draft'})
  const lastDue=z.status==='complete'?z.totalWeeks:Math.max(0,(native?.currentWeek??z.currentWeek)-1)
  const first=z.seasonStartWeek??1
  const {missing,pending}=settlementReadiness(resolutions,first,lastDue)
  checks.push({id:'settlement',label:'Weekly settlement',status:pending||missing?'attention':z.currentWeek===0?'waiting':'ready',
    detail:pending||missing?pending+' settlements or corrections need review; '+missing+' earlier scoring weeks have no settlement.':z.currentWeek===0?'Season has not started.':'No saved settlement is pending or flagged for correction. Verify the scoring calendar for missing weeks.'})
  checks.push({id:'updates',label:'Weekly chat updates',status:z.weeklyUpdateAutoPost&&!z.weeklyUpdateApproval?'ready':'attention',
    detail:z.weeklyUpdateAutoPost?(z.weeklyUpdateApproval?'Commissioner approval is required before posting.':'Automatic posting enabled.'):'Automatic posting is off. Whisperers can never trade.'})
  return {leagueId,name:z.name||league.name||'Zombie League',sport:z.sport,season:z.season,week:z.currentWeek,checks}
}
