import 'server-only'
import { prisma } from '@/lib/prisma'
import { getMyTeamData } from './myTeam'
import { buildTeamAlerts,freshTeamAlertRoster } from './teamAlerts'
import { findSportsPlayersForLeague } from '@/lib/player-identity/findSportsPlayerByLeagueId'
import { definiteInactive,freshAutoSubsEvidence } from './nativeAutoSubsPolicy'
import { dispatchTeamNotification } from './teamDeliveryReceipts'
import { createHash } from 'node:crypto'
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
  return {available:true,alerts}
}
export async function reconcileTeamAlertNotifications(leagueId:string,userId:string){
  const result=await readTeamAlerts(leagueId,userId)
  if(!result.available)return {evaluated:0,available:false}
  const profile=await prisma.userProfile.findUnique({where:{userId},select:{preferredLanguage:true}}),es=profile?.preferredLanguage==='es'
  const activeKeys=new Set<string>(),prefix=`team-workspace:${leagueId}:`
  let evaluated=0
  for(const a of result.alerts){
    const digest=createHash('sha256').update(a.key).digest('hex').slice(0,24),sourceKey=`${prefix}${digest}:${userId}`
    activeKeys.add(sourceKey)
    if(!a.fresh)continue
    // A persisted claim prevents repeat email/push as well as duplicate bell entries.
    const claim=`team-alert:${sourceKey}`
    try{await prisma.automationAuditLog.create({data:{id:claim,userId,leagueId,action:'team_alert.delivery_claimed',entityType:'notification',entityId:sourceKey,message:'League-scoped alert evaluated for delivery.',metadata:{kind:a.kind,deadline:a.deadline}}})}catch(e){if((e as {code?:string}).code==='P2002')continue;throw e}
    const deadline=new Intl.DateTimeFormat(es?'es':'en',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(a.deadline))+' UTC'
    const title=a.kind==='injury'?`${a.playerName} · ${a.leagueName}`:`${a.label} · ${a.leagueName}`
    const body=a.kind==='injury'?(es?`Baja registrada (${a.status}). Plazo: ${deadline}. Reserva elegible: ${a.alternative??'ninguna verificada'}.`:`Recorded inactive (${a.status}). Deadline: ${deadline}. Eligible backup: ${a.alternative??'none verified'}.`):(es?`Plazo registrado: ${deadline}. Revisa las reglas de esta liga.`:`Recorded deadline: ${deadline}. Review this league's rules.`)
    await dispatchTeamNotification({userIds:[userId],leagueId,category:a.kind==='injury'?'injury_alerts':'lineup_reminders',type:'team_workspace_alert',title,body,actionHref:a.href,actionLabel:a.kind==='injury'?(es?'Revisar titular y reservas':'Review starter and backups'):(es?'Revisar plazo':'Review deadline'),dedupePrefix:`${prefix}${digest}`,severity:'medium',meta:{kind:a.kind,deadline:a.deadline,evidenceSource:a.source,evidenceAt:a.observedAt,alternative:a.alternative}},claim)
    evaluated++
  }
  const previous=await prisma.platformNotification.findMany({where:{userId,leagueId,type:'team_workspace_alert',readAt:null},select:{id:true,sourceKey:true,meta:true}})
  for(const row of previous)if(row.sourceKey?.startsWith(prefix)&&!activeKeys.has(row.sourceKey))await prisma.platformNotification.update({where:{id:row.id},data:{readAt:new Date(),meta:{...(row.meta&&typeof row.meta==='object'&&!Array.isArray(row.meta)?row.meta:{}),resolvedAt:new Date().toISOString()}}})
  return {evaluated,available:true}
}
