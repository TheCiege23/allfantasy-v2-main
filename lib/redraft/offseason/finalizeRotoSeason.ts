import { getPlatformEvents, EVENT } from '@/lib/events'
import { prisma } from '@/lib/prisma'
import { updateStandings } from '../standingsEngine'
export type RotoFinalizeResult = {ok:true;format:'roto';alreadyFinalized:boolean;championRosterId:string;runnerUpRosterId:string|null;finalStandings:Array<{rosterId:string;teamName:string;rank:number;points:number;champion:boolean}>;events:[]} | {ok:false;code:'FINAL_ROUND_INCOMPLETE'|'NO_WINNER';message:string;events:[]}
/** A cumulative season ends on its last sealed period, never on a fabricated playoff final. */
export async function finalizeRotoSeason(seasonId:string, actorUserId?:string):Promise<RotoFinalizeResult> {
 const season=await prisma.redraftSeason.findUnique({where:{id:seasonId},include:{league:{select:{settings:true}}}})
 if(!season) throw new Error('season_not_found')
 const settings=season.league.settings as Record<string,any> | null
 if(settings?.scoring_mode!=='roto') throw new Error('not_roto')
 const saved=settings.roto_season_results?.[String(season.season)]
 if(season.status==='complete' && saved) return {ok:true,format:'roto',alreadyFinalized:true,...saved,events:[]}
 const generic=await prisma.roster.findMany({where:{leagueId:season.leagueId,redraftRosterId:{not:null}},select:{id:true}})
 const sealed=await prisma.teamWeekResult.findMany({where:{leagueId:season.leagueId,season:season.season,week:season.totalWeeks,status:'final'},select:{rosterId:true}})
 const sealedIds=new Set(sealed.map(r=>r.rosterId))
 if(!generic.length || generic.some(r=>!sealedIds.has(r.id))) return {ok:false,code:'FINAL_ROUND_INCOMPLETE',message:'The final rotisserie period is not fully scored.',events:[]}
 await updateStandings(seasonId,season.totalWeeks)
 const rosters=await prisma.redraftRoster.findMany({where:{seasonId},orderBy:[{pointsFor:'desc'},{id:'asc'}],select:{id:true,teamName:true,pointsFor:true}})
 if(!rosters.length || (rosters[1] && rosters[0].pointsFor===rosters[1].pointsFor)) return {ok:false,code:'NO_WINNER',message:'The rotisserie lead is tied; a commissioner must resolve the league tiebreaker.',events:[]}
 const championRosterId=rosters[0].id,runnerUpRosterId=rosters[1]?.id??null
 const finalStandings=rosters.map((r,i)=>({rosterId:r.id,teamName:r.teamName??'Team',rank:i+1,points:r.pointsFor,champion:i===0}))
 await prisma.$transaction(async tx=>{
  const current=await tx.league.findUnique({where:{id:season.leagueId},select:{settings:true}})
  const currentSettings=current?.settings as Record<string,any> | null
  await tx.league.update({where:{id:season.leagueId},data:{settings:{...(currentSettings??{}),roto_season_results:{...(currentSettings?.roto_season_results??{}),[String(season.season)]:{championRosterId,runnerUpRosterId,finalStandings}}}}})
  await tx.redraftSeason.update({where:{id:seasonId},data:{status:'complete'}})
 })
 await getPlatformEvents().emit(EVENT.CHAMPION_CROWNED,{leagueId:season.leagueId,seasonId,actor:actorUserId?{type:'commissioner',id:actorUserId}:{type:'system'},source:'engine:roto',idempotencyKey:`roto.champion:${seasonId}`,subjects:[{kind:'roster',id:championRosterId}],payload:{seasonId,championRosterId}})
 await getPlatformEvents().emit(EVENT.SEASON_COMPLETED,{leagueId:season.leagueId,seasonId,actor:actorUserId?{type:'commissioner',id:actorUserId}:{type:'system'},source:'engine:roto',idempotencyKey:`roto.season.completed:${seasonId}`,subjects:[{kind:'season',id:seasonId}],payload:{seasonId}})
 return {ok:true,format:'roto',alreadyFinalized:false,championRosterId,runnerUpRosterId,finalStandings,events:[]}
}
