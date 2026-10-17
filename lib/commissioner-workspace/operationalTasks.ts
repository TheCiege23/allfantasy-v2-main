import { prisma } from '@/lib/prisma'
import { readRequiredStarterCount } from '@/lib/commissioner-hub/requiredStarters'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { automaticLineup } from '@/lib/core-app/teamWorkspace'
import { leagueCalendar } from '@/lib/core-app/leagueCalendar'
import type { WorkspaceTaskCandidate } from './taskSources'
export function detectOperationalConditions(input:{leagueId:string;inSeason:boolean;manual:boolean;rostersReadable:boolean;required:number;rosters:Array<{id:string;name:string;starters:string[]}>;settings:unknown;pending:Array<{id:string}>;scoring:Array<{id:string;action:string;period:string}>},now:Date):WorkspaceTaskCandidate[]{
  const tasks:WorkspaceTaskCandidate[]=[],id=encodeURIComponent(input.leagueId)
  const add=(sourceKey:string,title:string,description:string,href:string,dueAt?:Date)=>tasks.push({sourceKey,title,description,priority:'elevated',automationCandidate:false,dueAt,relatedLinks:[{label:'Review league',moduleId:'settings',href}]})
  if(input.inSeason&&input.manual&&!input.rostersReadable)add('operational:coverage:v1','Roster evidence requires refresh','Roster evidence is stale or unreadable. Existing lineup findings remain open until a fresh roster can be read.',`/core/sync?league=${id}`)
  if(input.inSeason&&input.manual&&input.rostersReadable&&input.required>0)for(const roster of input.rosters){
    const count=roster.starters.filter(s=>s&&s!=='0').length
    if(count<input.required)add(`operational:lineup:${roster.id}:v1`,'Starting slots need review',`${roster.name}: ${count} of ${input.required} required starting slots are filled. Review the lineup and ask the manager to submit eligible starters.`,`/core/standings?league=${id}`)
  }
  for(const trade of input.pending)add(`operational:trade:${trade.id}:v1`,'Accepted trade awaits commissioner review','Both managers accepted this trade. Review the recorded proposal before approving or rejecting it.',`/core/trades?league=${id}`)
  const latest=new Map<string,typeof input.scoring[number]>()
  for(const row of input.scoring)if(!latest.has(row.period))latest.set(row.period,row)
  for(const row of latest.values())if(row.action==='scoring.recalc.failed')add(`operational:scoring:${row.id}:v1`,'Recorded scoring recalculation failed',`Period ${row.period}: a recorded scoring recalculation failed. Review the scoring rules and retry processing.`,`/league/${id}?view=settings`)
  for(const event of leagueCalendar(input.settings))if(event.at&&Date.parse(event.at)>now.getTime()&&Date.parse(event.at)-now.getTime()<=7*86400_000)add(`operational:deadline:${event.key}:${event.at}:v1`,'Recorded league deadline approaches',`${event.label}: this deadline is published in league settings. Review requirements before the recorded time.`,`/core/schedule?league=${id}`,new Date(event.at))
  return tasks
}
export async function readOperationalTasks(leagueId:string,now:Date):Promise<WorkspaceTaskCandidate[]>{
  const league=await prisma.league.findUnique({where:{id:leagueId}})
  if(!league)return []
  const native=resolveWriteAuthority(league.platform)==='NATIVE'
  const inSeason=['active','in_season'].includes(String(league.status??league.lifecycleState).toLowerCase())
  const fresh=native||!!league.lastSyncedAt&&now.getTime()-league.lastSyncedAt.getTime()<48*3600_000
  // Failed reads throw: reconciliation must not close old findings on an unreadable snapshot.
  const [rosters,pending,scoring,teams]=await Promise.all([
    prisma.roster.findMany({where:{leagueId},select:{id:true,platformUserId:true,playerData:true}}),
    native?prisma.afLeagueTrade.findMany({where:{leagueId,reviewType:'commissioner',status:'awaiting_commissioner',acceptedAt:{not:null}},select:{id:true}}):[],
    prisma.automationAuditLog.findMany({where:{leagueId,action:{in:['scoring.recalc.failed','scoring.recalc.resolved']}},orderBy:{createdAt:'desc'},select:{id:true,action:true,entityId:true}}),
    prisma.leagueTeam.findMany({where:{leagueId},select:{platformUserId:true,claimedByUserId:true,externalId:true,teamName:true}})
  ])
  return detectOperationalConditions({leagueId,inSeason,manual:!league.bestBallMode&&!automaticLineup(league.leagueType,league.settings),rostersReadable:fresh&&rosters.every(r=>{const d=r.playerData as Record<string,unknown>|null;const sections=d?.lineup_sections as Record<string,unknown>|undefined;return !!d&&(Array.isArray(sections?.starters)||Array.isArray(d.starters))}),required:readRequiredStarterCount(league),rosters:rosters.map(r=>({id:r.id,name:teams.find(t=>t.platformUserId===r.platformUserId||t.claimedByUserId===r.platformUserId)?.teamName??'Unnamed roster',starters:(()=>{const d=r.playerData as Record<string,unknown>|null;return Array.isArray((d?.lineup_sections as Record<string,unknown>|undefined)?.starters)?getNormalizedLineupSections(d).starters.map(s=>String(s.id)):Array.isArray(d?.starters)?d.starters.map(String):[]})()})),settings:league.settings,pending,scoring:scoring.map(s=>({id:s.id,action:s.action,period:s.entityId??'unknown'}))},now)
}
