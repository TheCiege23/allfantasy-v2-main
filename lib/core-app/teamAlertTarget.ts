import type { MyTeamData } from './myTeam'
import { automaticLineup } from './teamWorkspace'
export type TeamAlertTarget = { playerId: string; deadline: string; slotIndex: number }
export function teamInjuryAlertHref(leagueId:string,playerId:string,deadline:string,slotIndex:number){
  const params=new URLSearchParams({league:leagueId,alertPlayer:playerId,alertDeadline:deadline,alertSlot:String(slotIndex)})
  return `/core/my-team?${params.toString()}#af-team-alert-decision`
}
export function parseTeamAlertTarget(url:URL,leagueId:string):TeamAlertTarget|null{
  const p=url.searchParams,playerId=p.get('alertPlayer'),deadline=p.get('alertDeadline'),slot=p.get('alertSlot')
  if(p.get('league')!==leagueId || !playerId || playerId.length>200 || !deadline || deadline.length>40 || !Number.isFinite(Date.parse(deadline)) || !slot || !/^\d{1,2}$/.test(slot))return null
  return {playerId,deadline,slotIndex:Number(slot)}
}
export function teamAlertDecision(data:MyTeamData,target:TeamAlertTarget,now:number){
  if(data.bestBall||data.league.bestBall||data.league.lineupMode==='automatic'||automaticLineup(data.league.format))return {state:'automatic' as const,slotIndex:null,player:null}
  if(data.preDraft||data.completed||data.eliminated||!data.starters.available)return {state:'unavailable' as const,slotIndex:null,player:null}
  const slot=data.starters.data[target.slotIndex],player=slot?.player
  if(!player || player.sleeperId!==target.playerId)return {state:'lineup_changed' as const,slotIndex:null,player:null}
  if(Date.parse(target.deadline)<=now)return {state:'expired' as const,slotIndex:null,player}
  const kickoffAt=player.kickoff instanceof Date ? player.kickoff.getTime() : Date.parse(String(player.kickoff))
  if(!player.kickoff || kickoffAt!==Date.parse(target.deadline))return {state:'schedule_changed' as const,slotIndex:null,player}
  if(!player.ruledOut)return {state:'status_changed' as const,slotIndex:null,player}
  return {state:'current' as const,slotIndex:target.slotIndex,player}
}

export type DeadlineAlertTarget={key:string;deadline:string}
export function teamDeadlineAlertHref(leagueId:string,key:string,deadline:string){
  return `/core/schedule?${new URLSearchParams({league:leagueId,alertEvent:key,alertDeadline:deadline})}#af-team-deadline-alert`
}
export function parseDeadlineAlertTarget(params:URLSearchParams,leagueId:string):DeadlineAlertTarget|null{
  const key=params.get('alertEvent'),deadline=params.get('alertDeadline')
  return params.get('league')===leagueId && key && ['draft','waivers','trade','keeper'].includes(key) && deadline && deadline.length<=40 && Number.isFinite(Date.parse(deadline)) ? {key,deadline} : null
}
export function deadlineAlertDecision(events:readonly {key:string;at:string|null;label:string}[],target:DeadlineAlertTarget,now:number){
  const event=events.find(e=>e.key===target.key)
  if(!event?.at)return {state:'missing' as const,event:null}
  if(Date.parse(event.at)!==Date.parse(target.deadline))return {state:'changed' as const,event}
  if(Date.parse(target.deadline)<=now)return {state:'expired' as const,event}
  return {state:'current' as const,event}
}
