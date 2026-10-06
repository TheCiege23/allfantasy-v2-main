import 'server-only'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { readViewerPoll } from '@/lib/chat-core/messagePolls'
import { nativeWeeklyLeague } from './weeklyCapabilities'
import { absoluteCalendarTime, buildWeeklyCalendar, type WeeklyCalendarEvent, type WeeklyCalendarLeague } from './weeklyCalendar'
import type { MyTeamPulse } from './myTeamPulse'
/** The shell passes only leagues the viewer plays in; private chat and commissioner tasks have separate scopes. */
export async function getWeeklyCalendar(leagues:Array<WeeklyCalendarLeague&{platform?:string|null;platformLeagueId?:string|null}>,pulse:MyTeamPulse|null,now:Date,focus:string|null,commissionerIds:string[]) {
  const scoped=leagues.filter(l=>!focus||l.id===focus), ids=scoped.map(l=>l.id), nativeIds=scoped.filter(nativeWeeklyLeague).map(l=>l.id), commIds=commissionerIds.filter(id=>ids.includes(id))
  const through=new Date(now.getTime()+7*86400000)
  if(!ids.length)return buildWeeklyCalendar([],now)
  const reads=await Promise.allSettled([
    nativeIds.length?prisma.leagueWaiverState.findMany({where:{leagueId:{in:nativeIds},processingLocked:false,nextRunAt:{gte:now,lt:through}},select:{leagueId:true,nextRunAt:true}}):Promise.resolve([]),
    nativeIds.length?prisma.leagueSettings.findMany({where:{leagueId:{in:nativeIds},draftDateUtc:{gte:now,lt:through}},select:{leagueId:true,draftDateUtc:true}}):Promise.resolve([]),
    prisma.leagueChatMessage.findMany({where:{leagueId:{in:ids},isPrivate:false,visibleToUserId:null,source:null,NOT:{metadata:{path:['poll'],equals:Prisma.AnyNull}},createdAt:{gte:new Date(now.getTime()-60*86400000)}},select:{id:true,leagueId:true,metadata:true},orderBy:{createdAt:'desc'},take:500}),
    commIds.length?prisma.commissionerWorkspaceTask.findMany({where:{leagueId:{in:commIds},status:{in:['open','acknowledged','in_progress']},dueAt:{gte:now,lt:through}},select:{id:true,leagueId:true,title:true,dueAt:true},orderBy:{dueAt:'asc'},take:200}):Promise.resolve([])
  ])
  const extra:WeeklyCalendarEvent[]=[]
  const add=(id:string,leagueId:string,kind:WeeklyCalendarEvent['kind'],raw:unknown,source:WeeklyCalendarEvent['source'],title='')=>{const at=absoluteCalendarTime(raw);if(at)extra.push({id,leagueId,leagueName:'',kind,at,source,title,href:kind==='poll'?'/league/'+encodeURIComponent(leagueId)+'?view=league_chat':'/core/'+(kind==='waivers'?'waiver-wire':'commissioner')+'?league='+encodeURIComponent(leagueId)})}
  if(reads[0].status==='fulfilled')for(const r of reads[0].value)add(r.leagueId+':waivers',r.leagueId,'waivers',r.nextRunAt,'waiver-engine')
  if(reads[1].status==='fulfilled')for(const r of reads[1].value)add(r.leagueId+':draft',r.leagueId,'draft',r.draftDateUtc,'league-settings')
  if(reads[2].status==='fulfilled')for(const r of reads[2].value){const poll=readViewerPoll(r.metadata,null);if(poll&&!poll.closedByHand)add(r.id,r.leagueId,'poll',poll.closesAt,'league-chat',poll.question)}
  if(reads[3].status==='fulfilled')for(const r of reads[3].value)add(r.id,r.leagueId,'commissioner',r.dueAt,'commissioner-workspace',r.title)
  const rows=[...(pulse?.needs??[]),...(pulse?.set??[])]
  const calendarLeagues=scoped.map(l=>({...l,lineupAutomatic:rows.some(r=>r.leagueId===l.id&&(r.bestBall||r.automatic))}))
  return buildWeeklyCalendar(calendarLeagues,now,extra,[...(pulse?.needs??[]),...(pulse?.set??[])].filter(r=>!r.syncFailed&&r.unresolved===0).map(r=>({leagueId:r.leagueId,at:r.lockAt})),focus,reads.some(r=>r.status==='rejected'))
}
