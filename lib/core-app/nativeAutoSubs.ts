import 'server-only'
import { isRosterChopped } from '@/lib/guillotine/guillotineGuard'
import {rotateSweepTargets} from './teamSweepPolicy'
import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { applyStarterSwap } from '@/lib/roster/starterSwap'
import { getStarterSlotLabels } from '@/lib/league/rosterSlots'
import { isEligibleForSlot } from '@/lib/core-app/rosterSlots'
import { automaticLineup } from '@/lib/core-app/teamWorkspace'
import { leagueWeekFromSettings } from '@/lib/core-app/seasonTimeline'
import { findSportsPlayersForLeague } from '@/lib/player-identity/findSportsPlayerByLeagueId'
import { getPlayerGameLockStateForAutoCoach } from '@/lib/autocoach/playerGameLock'
import { persistRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'
import { readTeamPreference } from './teamPreferenceStore'
import { definiteInactive,freshAutoSubsEvidence,nativeAutoSubsKey,type NativeAutoSubsAssignment } from './nativeAutoSubsPolicy'
const settingsObject=(s:unknown)=>s&&typeof s==='object'&&!Array.isArray(s)?s as Record<string,unknown>:{}

/** Reads saved provider evidence only. Uncertain status or missing game times holds execution. */
export async function runNativeAutoSubsForLeague(leagueId:string,deadline=Date.now()+10_000) {
  const league=await prisma.league.findUnique({where:{id:leagueId}})
  if(!league || resolveWriteAuthority(league.platform)!=='NATIVE' || settingsObject(league.settings).nativeAutoSubsEnabled!==true || league.bestBallMode || automaticLineup(league.leagueType,league.settings) || !['active','in_season'].includes(String(league.status ?? league.lifecycleState).toLowerCase())) return []
  const week=leagueWeekFromSettings(league.settings),season=league.season
  if(!season || week==null || !Number.isInteger(week)) return []
  const rosters=await prisma.roster.findMany({where:{leagueId},orderBy:{id:'asc'},take:64})
  const results:Array<{rosterId:string;applied:boolean;reason:string}>=[]
  for(const roster of rotateSweepTargets(rosters,Date.now())) {
    if(Date.now()>=deadline) break
    if(await isRosterChopped(leagueId,roster.id)) continue
    const owner=roster.platformUserId,key=nativeAutoSubsKey(leagueId,roster.id,season,week)
    const assignment=await readTeamPreference<NativeAutoSubsAssignment>(owner,key)
    if(!assignment?.enabled) continue
    const sections=getNormalizedLineupSections(roster.playerData),starters=sections.starters.map(p=>String(p.id))
    if(JSON.stringify(starters)!==JSON.stringify(assignment.starters)) {results.push({rosterId:roster.id,applied:false,reason:'lineup_changed'});continue}
    const ids=[...starters,...Object.values(assignment.backups)],players=await findSportsPlayersForLeague(String(league.sport),league.platform,ids)
    const labels=getStarterSlotLabels(Array.isArray(league.starters)?league.starters as string[]:[])
    for(const [slot,backup] of Object.entries(assignment.backups)) {
      if(Date.now()>=deadline) break
      const index=Number(slot),outId=starters[index],out=players.get(outId),into=players.get(backup),now=Date.now()
      if(!out || !into || !sections.bench.some(p=>String(p.id)===backup) || !labels[index] || !isEligibleForSlot(labels[index],into.position)) continue
      if(!definiteInactive(out.status) || definiteInactive(into.status) || !['ACTIVE','HEALTHY','AVAILABLE'].includes((into.status??'').toUpperCase()) || !freshAutoSubsEvidence(out,now) || !freshAutoSubsEvidence(into,now)) {results.push({rosterId:roster.id,applied:false,reason:'status_evidence_unavailable_or_stale'});continue}
      const args={sport:String(league.sport),leagueSeason:season,leagueSettings:league.settings}
      const [outLock,inLock]=await Promise.all([getPlayerGameLockStateForAutoCoach({...args,teamAbbr:out.team}),getPlayerGameLockStateForAutoCoach({...args,teamAbbr:into.team})])
      if((outLock.nextKickoffUtc?.getTime()??Infinity)>now+7*86400_000 || (inLock.nextKickoffUtc?.getTime()??Infinity)>now+7*86400_000 || !outLock.scheduleKnown || !inLock.scheduleKnown || !outLock.nextKickoffUtc || !inLock.nextKickoffUtc || outLock.lockedBecauseGameStarted || inLock.lockedBecauseGameStarted) {results.push({rosterId:roster.id,applied:false,reason:'game_lock_or_schedule_unavailable'});continue}
      const auditId=`native-autosub:${JSON.stringify([leagueId,roster.id,season,week,assignment.version,outId,backup])}`
      if(await prisma.automationAuditLog.findUnique({where:{id:auditId}})) continue
      const next=applyStarterSwap(roster.playerData,index,backup)
      try {
        const saved=await persistRosterLineupWithEngine({leagueId,rosterId:roster.id,actorUserId:owner,expectedOwnerUserId:owner,season,week,source:'system',expectedStarters:starters,nextPlayerData:next,
          transactionCheck:async tx=>{
            // Lock authorization rows until the mutation commits; disabling either opt-in wins first.
            await tx.$queryRaw`SELECT id FROM leagues WHERE id=${leagueId} FOR SHARE`
            await tx.$queryRaw`SELECT "userId" FROM user_profiles WHERE "userId"=${owner} FOR UPDATE`
            const currentLeague=await tx.league.findUnique({where:{id:leagueId}}),profile=await tx.userProfile.findUnique({where:{userId:owner}})
            const current=(profile?.corePreferences as Record<string,unknown>|null)?.[key] as NativeAutoSubsAssignment|undefined
            await tx.$queryRaw`SELECT id FROM "SportsPlayer" WHERE id IN (${out.id},${into.id}) FOR SHARE`
            const statusRows=await tx.sportsPlayer.findMany({where:{id:{in:[out.id,into.id]}}})
            const currentOut=statusRows.find(p=>p.id===out.id),currentIn=statusRows.find(p=>p.id===into.id)
            const n=Date.now()
            if(!currentOut || !currentIn || currentOut.team!==out.team || currentIn.team!==into.team || currentIn.position!==into.position || currentOut.status!==out.status || currentIn.status!==into.status || !freshAutoSubsEvidence(currentOut,n) || !freshAutoSubsEvidence(currentIn,n)) throw new Error('AUTOSUB_STATUS_CHANGED')
            await tx.$queryRaw`SELECT id FROM "SportsGame" WHERE sport=${String(league.sport)} AND "startTime" BETWEEN ${new Date(n-12*3600_000)} AND ${new Date(n+7*86400_000)} AND ("homeTeam" ILIKE ${out.team??''} OR "awayTeam" ILIKE ${out.team??''} OR "homeTeam" ILIKE ${into.team??''} OR "awayTeam" ILIKE ${into.team??''}) FOR SHARE`
            const currentLocks=await Promise.all([getPlayerGameLockStateForAutoCoach({...args,teamAbbr:out.team,db:tx,nowUtc:new Date()}),getPlayerGameLockStateForAutoCoach({...args,teamAbbr:into.team,db:tx,nowUtc:new Date()})])
            if(currentLocks.some(l=>!l.scheduleKnown || l.lockedBecauseGameStarted || !l.nextKickoffUtc || l.nextKickoffUtc.getTime()<=Date.now())) throw new Error('AUTOSUB_GAME_LOCK_CHANGED')
            if(!currentLeague || resolveWriteAuthority(currentLeague.platform)!=='NATIVE' || currentLeague.updatedAt.getTime()!==league.updatedAt.getTime() || leagueWeekFromSettings(currentLeague.settings)!==week || currentLeague.season!==season || currentLeague.bestBallMode || currentLeague.lockAllMoves || !['active','in_season'].includes(String(currentLeague.status??currentLeague.lifecycleState).toLowerCase()) || settingsObject(currentLeague.settings).nativeAutoSubsEnabled!==true || !current?.enabled || current.version!==assignment.version || outLock.nextKickoffUtc!.getTime()<=n || inLock.nextKickoffUtc!.getTime()<=n || !freshAutoSubsEvidence(out,n) || !freshAutoSubsEvidence(into,n)) throw new Error('AUTOSUB_AUTHORIZATION_CHANGED')
            // Advance the authorization snapshot atomically so other assigned slots can run next sweep.
            const remaining={...current.backups};delete remaining[slot]
            const updated=JSON.stringify({...current,enabled:Object.keys(remaining).length>0,backups:remaining,starters:Array.isArray(next.starters)?next.starters.map(String):[],version:current.version+1,updatedAt:new Date().toISOString()})
            await tx.$executeRaw`UPDATE user_profiles SET core_preferences=COALESCE(core_preferences,'{}'::jsonb)||jsonb_build_object(${key}::text,${updated}::jsonb),"updatedAt"=NOW() WHERE "userId"=${owner}`
          },
          automationAudit:{id:auditId,action:'native_autosub.applied',message:`${out.name} (${out.status}) → ${into.name}; owner-assigned backup in ${labels[index]}.`,metadata:{season,week,slot:index,playerOutId:outId,playerInId:backup,statusSource:out.source,statusFetchedAt:out.fetchedAt.toISOString(),assignmentVersion:assignment.version}}
        })
        if(!saved.ok){results.push({rosterId:roster.id,applied:false,reason:saved.error});continue}
        const verified=await prisma.roster.findUnique({where:{id:roster.id},select:{playerData:true}})
        const verifiedSections=getNormalizedLineupSections(verified?.playerData)
        const applied=String(verifiedSections.starters[index]?.id)===backup && verifiedSections.bench.some(p=>String(p.id)===outId)
        results.push({rosterId:roster.id,applied,reason:applied?'saved_and_verified':'saved_refresh_required'})
        if(applied) await dispatchNotification({userIds:[owner],leagueId,category:'autocoach',type:'native_autosub_applied',title:'Native AutoSubs · '+(league.name??'AllFantasy'),body:`${out.name} (${out.status}) → ${into.name}. Your assigned backup was saved and verified.`,actionHref:`/core/my-team?league=${encodeURIComponent(leagueId)}`,dedupePrefix:auditId,severity:'medium',meta:{auditId,season,week,playerOutId:outId,playerInId:backup}}).catch(()=>{})
        // One backup per roster per sweep; the next sweep reads the new roster snapshot.
        break
      }catch{results.push({rosterId:roster.id,applied:false,reason:'authorization_changed_or_conflicting_save'})}
    }
  }
  return results
}
