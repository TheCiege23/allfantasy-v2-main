import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveRostersForTeams } from '@/lib/leagues/rosterTeamIdentity'
import { sleeperReadableRosters } from './rosterIdSpace'
import type { MyTeamRow } from './myTeamPulse'

export type OpponentExposure = { id:string; name:string; sport:string; leagues:Array<{id:string;name:string;week:number}> }
export async function portfolioOpponentExposure(rows: MyTeamRow[]): Promise<OpponentExposure[]> {
  const candidates=rows.filter(r=>!r.archived && r.platformLeagueId && r.teamId && r.week && r.season)
  if(!candidates.length)return []
  const [fixtures,teams,rosters]=await Promise.all([
    prisma.weeklyMatchup.findMany({where:{OR:candidates.map(r=>({leagueId:r.platformLeagueId!,seasonYear:r.season!,week:r.week!}))},select:{leagueId:true,seasonYear:true,week:true,rosterId:true,matchupId:true}}),
    prisma.leagueTeam.findMany({where:{leagueId:{in:candidates.map(r=>r.leagueId)}},select:{id:true,leagueId:true,externalId:true,platformUserId:true,claimedByUserId:true}}),
    prisma.roster.findMany({where:{leagueId:{in:candidates.map(r=>r.leagueId)}},select:{id:true,leagueId:true,platformUserId:true,playerData:true}}),
  ])
  const opposing=new Map<string,{sport:string;league:OpponentExposure['leagues'][number]}>()
  const selected:Array<{row:MyTeamRow;playerData:unknown}>=[]
  for(const row of candidates){
    const week=fixtures.filter(f=>f.leagueId===row.platformLeagueId && f.seasonYear===row.season && f.week===row.week)
    const mine=week.find(f=>f.rosterId===row.teamId)
    if(mine?.matchupId==null)continue
    const pair=week.filter(f=>f.matchupId===mine.matchupId && f.rosterId!==row.teamId)
    if(pair.length!==1)continue
    const leagueTeams=teams.filter(t=>t.leagueId===row.leagueId)
    const resolved=resolveRostersForTeams(leagueTeams,rosters.filter(r=>r.leagueId===row.leagueId),t=>[t.platformUserId,t.externalId,t.claimedByUserId])
    const roster=resolved.get(pair[0].rosterId)
    if(roster)selected.push({row,playerData:roster.playerData})
  }
  const readableRosters=await sleeperReadableRosters(selected,r=>r.row.platform)
  for(const {row,playerData:readable} of readableRosters){
    const ids=(readable as Record<string,unknown> | null)?.starters
    if(!Array.isArray(ids))continue
    for(const id of ids)if(typeof id==='string' && id && id!=='0')opposing.set(`${row.leagueId}:${id}`,{sport:row.sport ?? 'NFL',league:{id:row.leagueId,name:row.leagueName,week:row.week!}})
  }
  const ids=[...new Set([...opposing.keys()].map(k=>k.slice(k.lastIndexOf(':')+1)))]
  if(!ids.length)return []
  const players=await prisma.sportsPlayer.findMany({where:{sleeperId:{in:ids}},select:{sleeperId:true,name:true,sport:true}})
  const result=new Map<string,OpponentExposure>()
  for(const [key,value] of opposing){const id=key.slice(key.lastIndexOf(':')+1);const p=players.find(p=>p.sleeperId===id && String(p.sport)===value.sport);if(!p)continue;const k=`${value.sport}:${id}`;const item=result.get(k)??{id,name:p.name,sport:value.sport,leagues:[]};item.leagues.push(value.league);result.set(k,item)}
  return [...result.values()].sort((a,b)=>b.leagues.length-a.leagues.length)
}
