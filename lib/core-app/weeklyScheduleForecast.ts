import type { MyTeamRow } from './myTeamPulse'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
export type WeeklyScheduledGame={sport:string;season:number|null;seasonType:string|null;homeTeam:string;awayTeam:string;startTime:string|null;status:string|null;fetchedAt:string;expiresAt:string}
export type WeeklyScheduleForecast={
 leagueId:string;leagueName:string;sport:string;from:string;through:string;
 players:Array<{id:string;name:string;position:string|null;starter:boolean;games:number|null;dates:string[];backToBackDays:number;role:'goalie'|'pitcher'|'other'}>;
 gaps:string[];sampledAt:string|null
}
const club=(sport:string,value:string|null|undefined)=>sport==='NFL'?normalizeTeamAbbrev(value):value?.trim().replace(/\s+/g,' ').toUpperCase()||null
const regular=(value:string|null)=>['regular','reg','regular_season','regularseason'].includes((value??'').toLowerCase().trim())
const scheduled=(value:string|null)=>['scheduled','not_started','not started','ns','status_scheduled','pre'].includes((value??'').toLowerCase().trim())
/** Stored schedule evidence is a lower bound, never an assertion that ingestion is complete. */
export function buildWeeklyScheduleForecast(row:MyTeamRow,games:WeeklyScheduledGame[],now:Date,readFailed=false):WeeklyScheduleForecast {
 const sport=row.sport?.toUpperCase()??'UNKNOWN',from=now.toISOString(),through=new Date(now.getTime()+7*86400000).toISOString(),gaps:string[]=[]
 const result:WeeklyScheduleForecast={leagueId:row.leagueId,leagueName:row.leagueName,sport,from,through,players:[],gaps,sampledAt:null}
 if(row.archived || row.syncFailed || row.coverageReason || !row.players?.length){gaps.push('roster');return result}
 if(readFailed){gaps.push('schedule');return result}
 // No request-time providers or per-league reads. Require the roster's own season and sport.
 const season=row.leagueSeason??row.season
 const relevant=games.filter(g=>g.sport.toUpperCase()===sport&&g.season===season&&regular(g.seasonType)&&scheduled(g.status)&&g.startTime&&Date.parse(g.startTime)>=now.getTime()&&Date.parse(g.startTime)<Date.parse(through)&&Date.parse(g.expiresAt)>now.getTime()&&Date.parse(g.fetchedAt)<=now.getTime())
 const unique=new Map<string,WeeklyScheduledGame>()
 for(const g of relevant) {
  const home=club(sport,g.homeTeam),away=club(sport,g.awayTeam)
  if(!home||!away||home===away)continue
  const key=home+':'+away+':'+new Date(g.startTime!).toISOString()
  const prior=unique.get(key)
  if(!prior||Date.parse(g.fetchedAt)>Date.parse(prior.fetchedAt))unique.set(key,g)
 }
 const fixtures=[...unique.values()]
 result.sampledAt=fixtures.length?new Date(Math.min(...fixtures.map(g=>Date.parse(g.fetchedAt)))).toISOString():null
 const seen=new Set<string>()
 for(const p of row.players) {
  if(seen.has(p.id))continue;seen.add(p.id)
  const team=club(sport,p.team)
  const dates=team?[...new Set(fixtures.filter(g=>club(sport,g.homeTeam)===team||club(sport,g.awayTeam)===team).map(g=>new Date(g.startTime!).toISOString()))].sort():[]
  const days=[...new Set(dates.map(d=>d.slice(0,10)))]
  const backToBackDays=days.slice(1).filter((d,i)=>Date.parse(d)-Date.parse(days[i])===86400000).length
  const position=p.position?.toUpperCase()??null
  const role=sport==='NHL'&&position==='G'?'goalie':sport==='MLB'&&['P','SP','RP'].includes(position??'')?'pitcher':'other'
  result.players.push({id:p.id,name:p.name,position,starter:p.starter,games:dates.length||null,dates,backToBackDays,role})
 }
 gaps.push('schedule-completeness','scoring-format','lineup-limits')
 if(result.players.some(p=>p.games===null))gaps.push('player-schedule')
 if(['NBA','NCAAB','NHL','MLB'].includes(sport))gaps.push('category-forecast')
 if(result.players.some(p=>p.role==='goalie'))gaps.push('confirmed-goalie-starts')
 if(result.players.some(p=>p.role==='pitcher'))gaps.push('confirmed-pitcher-starts')
 return result
}
