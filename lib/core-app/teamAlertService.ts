import 'server-only'
import {issueAlertMeasurement} from './teamAlertEngagement'
import {measuredAlertHref} from './teamAlertClientMetrics'
import { prisma } from '@/lib/prisma'
import { getMyTeamData } from './myTeam'
import { buildTeamAlerts,freshTeamAlertRoster } from './teamAlerts'
import { findSportsPlayersForLeague } from '@/lib/player-identity/findSportsPlayerByLeagueId'
import { definiteInactive,freshAutoSubsEvidence } from './nativeAutoSubsPolicy'
import { dispatchTeamNotification } from './teamDeliveryReceipts'
import { createHash } from 'node:crypto'
import { planPlayerNews, markPlayerNewsTold, playerNewsDispatches, type PlayerNewsSubject } from '@/lib/notifications/playerNewsGate'
import { statusBucket } from '@/lib/notifications/playerNewsStatus'
export async function readTeamAlerts(leagueId:string,userId:string){
  const [data,league]=await Promise.all([getMyTeamData(leagueId,userId,null,{savedRosterOnly:true,alertPreviewOnly:true}),prisma.league.findUnique({where:{id:leagueId},select:{settings:true,lastSyncedAt:true}})])
  if(!data||!league)return {available:false,alerts:[]}
  if(!data.starters.available||!freshTeamAlertRoster(data.league.platform,league.lastSyncedAt,Date.now()))return {available:false,alerts:[]}
  const alerts=buildTeamAlerts(data,league.settings,Date.now()),ids=[...new Set(alerts.flatMap(a=>a.playerId?[a.playerId]:[]))]
  const evidence=ids.length ? await findSportsPlayersForLeague(data.league.sport??data.starters.data.find(s=>s.player?.sport)?.player?.sport??'',data.league.platform,ids,{translated:true}) : new Map()
  for(const a of alerts){
    if(a.kind==='deadline'){a.observedAt=league.lastSyncedAt?.toISOString()??null;continue}
    const p=a.playerId?evidence.get(a.playerId):null
    if(p){a.source=p.source;a.observedAt=p.fetchedAt.toISOString();a.fresh=freshAutoSubsEvidence(p,Date.now())&&definiteInactive(p.status)}
  }
  return {available:true,alerts,sport:data.league.sport??data.starters.data.find(s=>s.player?.sport)?.player?.sport??null}
}

/**
 * The shared player-news key for a starter alert: the registry id when the Sleeper id resolves, so a
 * player ruled out in three leagues — and by the news feed and the injury sync too — is ONE alert.
 */
async function teamAlertSubject(sport:string|null,a:{playerId:string|null;status:string|null}):Promise<PlayerNewsSubject>{
  const bucket=statusBucket(a.status??'out')
  let row:{id:string}|null=null
  // An unreadable registry falls back to the Sleeper id: still one alert per league set, just not shared.
  try{if(sport&&a.playerId)row=await prisma.playerIdentityMap.findFirst({where:{sport,sleeperId:a.playerId},select:{id:true}})}catch{row=null}
  return {playerKey:row?.id??`sleeper:${sport??'?'}:${a.playerId??'?'}`,bucket:bucket==='other'?'out':bucket}
}
export async function reconcileTeamAlertNotifications(leagueId:string,userId:string){
  const result=await readTeamAlerts(leagueId,userId)
  if(!result.available)return {evaluated:0,available:false}
  const profile=await prisma.userProfile.findUnique({where:{userId},select:{preferredLanguage:true}}),es=profile?.preferredLanguage==='es'
  const activeKeys=new Set<string>(),activeTargets=new Map<string,string>(),prefix=`team-workspace:${leagueId}:`
  let evaluated=0
  for(const a of result.alerts){
    const digest=createHash('sha256').update(a.key).digest('hex').slice(0,24),sourceKey=`${prefix}${digest}:${userId}`
    const href=measuredAlertHref(a.href,issueAlertMeasurement(userId,leagueId,a.key,a.kind))
    activeKeys.add(sourceKey);activeTargets.set(sourceKey,href)
    if(!a.fresh)continue
    // Injury alerts go through the player-news gate: the person's level, and one alert per player
    // and status a day across every league and sender. Deadline alerts are not player news.
    const subject=a.kind==='injury'?await teamAlertSubject(result.sport??null,a):null
    const plan=subject?await planPlayerNews([userId],subject,()=>'starter'):null
    if(plan&&!plan.instant.length&&!plan.digest.length)continue
    // A persisted claim prevents repeat email/push as well as duplicate bell entries.
    const claim=`team-alert:${sourceKey}`
    try{await prisma.automationAuditLog.create({data:{id:claim,userId,leagueId,action:'team_alert.delivery_claimed',entityType:'notification',entityId:sourceKey,message:'League-scoped alert evaluated for delivery.',metadata:{kind:a.kind,deadline:a.deadline}}})}catch(e){if((e as {code?:string}).code==='P2002')continue;throw e}
    const deadline=new Intl.DateTimeFormat(es?'es':'en',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(a.deadline))+' UTC'
    const title=a.kind==='injury'?`${a.playerName} · ${a.leagueName}`:`${a.label} · ${a.leagueName}`
    const body=a.kind==='injury'?(es?`Baja registrada (${a.status}). Plazo: ${deadline}. Reserva elegible: ${a.alternative??'ninguna verificada'}.`:`Recorded inactive (${a.status}). Deadline: ${deadline}. Eligible backup: ${a.alternative??'none verified'}.`):(es?`Plazo registrado: ${deadline}. Revisa las reglas de esta liga.`:`Recorded deadline: ${deadline}. Review this league's rules.`)
    const params={userIds:[userId],leagueId,category:a.kind==='injury'?'injury_alerts' as const:'lineup_reminders' as const,type:'team_workspace_alert',title,body,actionHref:href,actionLabel:a.kind==='injury'?(es?'Revisar titular y reservas':'Review starter and backups'):(es?'Revisar plazo':'Review deadline'),dedupePrefix:`${prefix}${digest}`,severity:'medium' as const,meta:{kind:a.kind,deadline:a.deadline,evidenceSource:a.source,evidenceAt:a.observedAt,alternative:a.alternative}}
    if(subject&&plan){
      // Push + bell (or bell only), never an email: the daily roster digest carries it.
      for(const gated of playerNewsDispatches(params,plan,{playerName:a.playerName??'',status:a.status,starter:true}))await dispatchTeamNotification(gated,claim)
      await markPlayerNewsTold([userId],subject)
    }else await dispatchTeamNotification(params,claim)
    evaluated++
  }
  const previous=await prisma.platformNotification.findMany({where:{userId,leagueId,type:'team_workspace_alert',readAt:null},select:{id:true,sourceKey:true,meta:true}})
  for(const row of previous){
    if(!row.sourceKey?.startsWith(prefix))continue
    const href=activeTargets.get(row.sourceKey)
    const meta=row.meta&&typeof row.meta==='object'&&!Array.isArray(row.meta)?row.meta:{}
    if(href){
      if(meta.actionHref===href)continue
      // Merge only the target field atomically: delivery receipt updates may occur concurrently.
      // Already-claimed alerts are upgraded without sending another push or email.
      await prisma.$executeRaw`UPDATE "platform_notifications"
        SET "meta" = (CASE WHEN jsonb_typeof("meta")='object' THEN "meta" ELSE '{}'::jsonb END) || ${JSON.stringify({actionHref:href})}::jsonb
        WHERE "id"=${row.id} AND "userId"=${userId} AND "leagueId"=${leagueId}
          AND "type"='team_workspace_alert' AND "sourceKey"=${row.sourceKey} AND "readAt" IS NULL`
    }else{
      await prisma.$executeRaw`UPDATE "platform_notifications"
        SET "readAt"=NOW(), "meta"=(CASE WHEN jsonb_typeof("meta")='object' THEN "meta" ELSE '{}'::jsonb END) || ${JSON.stringify({resolvedAt:new Date().toISOString()})}::jsonb
        WHERE "id"=${row.id} AND "userId"=${userId} AND "leagueId"=${leagueId}
          AND "type"='team_workspace_alert' AND "sourceKey"=${row.sourceKey} AND "readAt" IS NULL`
    }
  }

  return {evaluated,available:true}
}
