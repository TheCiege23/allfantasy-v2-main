import { isNativePlatform } from '@/lib/league/isNativeLeague'
import type { MyTeamData } from './myTeam'
import { eligibleComparisons } from './teamWorkspace'
import { leagueCalendar } from './leagueCalendar'
import { teamInjuryAlertHref,teamDeadlineAlertHref } from './teamAlertTarget'
export type TeamAlert={key:string;kind:'injury'|'deadline';leagueId:string;leagueName:string;playerId:string|null;playerName:string|null;status:string|null;deadline:string;source:string;observedAt:string|null;alternative:string|null;href:string;fresh:boolean;label:string}
/** Deadlines are recorded timestamps. A week number is never guessed into a date. */
export function buildTeamAlerts(data:MyTeamData,settings:unknown,now:number):TeamAlert[]{
  const league=data.league,alerts:TeamAlert[]=[]
  if(data.preDraft||data.completed||data.eliminated)return alerts
  for(const comparison of eligibleComparisons(data,now)){
    const p=comparison.slot.player
    if(!p?.ruledOut || !p.kickoff || new Date(p.kickoff).getTime()<=now || new Date(p.kickoff).getTime()-now>7*86400_000)continue
    const alternative=comparison.candidates.find(c=>!c.started&&!c.player.ruledOut&&!c.player.onBye&&c.player.kickoff&&new Date(c.player.kickoff).getTime()>now)?.player.name??null
    alerts.push({key:`injury:${p.sleeperId}:${new Date(p.kickoff).toISOString()}`,kind:'injury',leagueId:league.id,leagueName:league.name,playerId:p.sleeperId,playerName:p.name,status:p.injuryStatus,deadline:new Date(p.kickoff).toISOString(),source:'Saved roster and schedule',observedAt:null,alternative,href:teamInjuryAlertHref(league.id,p.sleeperId,new Date(p.kickoff).toISOString(),comparison.index),fresh:false,label:comparison.slot.slotLabel})
  }
  for(const event of leagueCalendar(settings)){
    if(!event.at || Date.parse(event.at)<=now || Date.parse(event.at)-now>24*3600_000)continue
    alerts.push({key:`deadline:${event.key}:${event.at}`,kind:'deadline',leagueId:league.id,leagueName:league.name,playerId:null,playerName:null,status:null,deadline:event.at,source:'League settings',observedAt:null,alternative:null,href:teamDeadlineAlertHref(league.id,event.key,event.at),fresh:true,label:event.label})
  }
  return alerts.sort((a,b)=>a.deadline.localeCompare(b.deadline))
}

/** Imported roster membership must be recently synced before alerts can clear or notify. */
export function freshTeamAlertRoster(platform:string,lastSyncedAt:Date|null,now:number){
  return isNativePlatform(platform)||!!lastSyncedAt&&lastSyncedAt.getTime()<=now&&now-lastSyncedAt.getTime()<=30*60_000
}
