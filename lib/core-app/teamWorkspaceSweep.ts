import 'server-only'
import { prisma } from '@/lib/prisma'
import { NATIVE_PLATFORM_VALUES } from '@/lib/dashboard/platform-label'
import { runNativeAutoSubsForLeague } from './nativeAutoSubs'
import { reconcileTeamAlertNotifications } from './teamAlertService'
/** Bounded phases ride the existing alert sweep; no new cron schedules or provider calls. */
export async function runTeamWorkspaceSweep(userIds:string[],deadline:number){
  const outcome={nativeLeagues:0,swaps:0,alertsEvaluated:0,errors:0,budgetStopped:false}
  const nativeWhere={platform:{in:[...NATIVE_PLATFORM_VALUES]},settings:{path:['nativeAutoSubsEnabled'],equals:true},status:{in:['active','in_season']}}
  const count=await prisma.league.count({where:nativeWhere})
  if(count&&Date.now()<deadline){
    const skip=(Math.floor(Date.now()/300_000)*8)%count
    const leagues=await prisma.league.findMany({where:nativeWhere,orderBy:{id:'asc'},skip,take:8,select:{id:true}})
    for(const l of leagues){if(Date.now()>=deadline){outcome.budgetStopped=true;break}try{const r=await runNativeAutoSubsForLeague(l.id,deadline);outcome.nativeLeagues++;outcome.swaps+=r.filter(s=>s.applied).length}catch{outcome.errors++}}
  }
  for(const userId of userIds){
    if(Date.now()>=deadline){outcome.budgetStopped=true;break}
    const where={status:{in:['active','in_season']},OR:[{userId},{teams:{some:{claimedByUserId:userId}}},{rosters:{some:{platformUserId:userId}}},{redraftMembers:{some:{userId}}}]}
    const total=await prisma.league.count({where})
    if(!total)continue
    const skip=(Math.floor(Date.now()/300_000)*2)%total
    const leagues=await prisma.league.findMany({where,orderBy:{id:'asc'},skip,take:2,select:{id:true}})
    for(const l of leagues){if(Date.now()>=deadline){outcome.budgetStopped=true;break}try{await reconcileTeamAlertNotifications(l.id,userId);outcome.alertsEvaluated++}catch{outcome.errors++}}
  }
  return outcome
}
