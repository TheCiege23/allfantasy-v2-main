import 'server-only'
import {rotateSweepTargets,nativeSweepDeadline,teamSweepBatchOffset} from './teamSweepPolicy'
import { prisma } from '@/lib/prisma'
import { NATIVE_PLATFORM_VALUES } from '@/lib/dashboard/platform-label'
import { runNativeAutoSubsForLeague } from './nativeAutoSubs'
import { reconcileTeamAlertNotifications } from './teamAlertService'
import { reconcileTeamDeliveryReceipts } from './teamDeliveryReconciliation'
/** Bounded phases ride the existing alert sweep; delivery reconciliation only reads provider receipts. */
export async function runTeamWorkspaceSweep(userIds:string[],deadline:number){
  const outcome={nativeLeagues:0,swaps:0,alertsEvaluated:0,errors:0,budgetStopped:false,deliveryReceiptsChecked:0}
  if(Date.now()<deadline)try{outcome.deliveryReceiptsChecked=(await reconcileTeamDeliveryReceipts(Math.min(deadline,Date.now()+3000))).checked}catch{outcome.errors++}
  const nativeDeadline=nativeSweepDeadline(deadline,Date.now())
  const nativeWhere={platform:{in:[...NATIVE_PLATFORM_VALUES]},settings:{path:['nativeAutoSubsEnabled'],equals:true},status:{in:['active','in_season']}}
  const count=await prisma.league.count({where:nativeWhere})
  if(count&&Date.now()<nativeDeadline){
    const skip=teamSweepBatchOffset(count,8,Date.now())
    const leagues=await prisma.league.findMany({where:nativeWhere,orderBy:{id:'asc'},skip,take:8,select:{id:true}})
    for(const l of leagues){if(Date.now()>=nativeDeadline){outcome.budgetStopped=true;break}try{const r=await runNativeAutoSubsForLeague(l.id,nativeDeadline);outcome.nativeLeagues++;outcome.swaps+=r.filter(s=>s.applied).length}catch{outcome.errors++}}
  }
  for(const userId of rotateSweepTargets(userIds,Date.now())){
    if(Date.now()>=deadline){outcome.budgetStopped=true;break}
    const where={status:{in:['active','in_season']},OR:[{userId},{teams:{some:{claimedByUserId:userId}}},{rosters:{some:{platformUserId:userId}}},{redraftMembers:{some:{userId}}}]}
    const total=await prisma.league.count({where})
    if(!total)continue
    const skip=teamSweepBatchOffset(total,2,Date.now())
    const leagues=await prisma.league.findMany({where,orderBy:{id:'asc'},skip,take:2,select:{id:true}})
    for(const l of leagues){if(Date.now()>=deadline){outcome.budgetStopped=true;break}try{await reconcileTeamAlertNotifications(l.id,userId);outcome.alertsEvaluated++}catch{outcome.errors++}}
  }
  return outcome
}
