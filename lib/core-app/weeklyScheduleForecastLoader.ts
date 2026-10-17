import 'server-only'
import { prisma } from '@/lib/prisma'
import type { MyTeamPulse } from './myTeamPulse'
import { buildWeeklyScheduleForecast,type WeeklyScheduleForecast } from './weeklyScheduleForecast'
export async function getWeeklyScheduleForecasts(pulse:MyTeamPulse|null,leagueIds:string[],now:Date):Promise<WeeklyScheduleForecast[]> {
 const allowed=new Set(leagueIds),rows=(pulse?.inventory??[...pulse?.needs??[],...pulse?.set??[]]).filter(r=>allowed.has(r.leagueId)&&!r.archived)
 if(!rows.length)return []
 const sports=[...new Set(rows.map(r=>r.sport).filter((s):s is string=>!!s))],seasons=[...new Set(rows.map(r=>r.leagueSeason??r.season).filter((s):s is number=>s!=null))]
 let failed=false
 const games=await prisma.sportsGame.findMany({where:{sport:{in:sports},season:{in:seasons},startTime:{gte:now,lt:new Date(now.getTime()+7*86400000)},expiresAt:{gt:now}},select:{sport:true,season:true,seasonType:true,homeTeam:true,awayTeam:true,startTime:true,status:true,fetchedAt:true,expiresAt:true},orderBy:{startTime:'asc'},take:1201}).catch(()=>{failed=true;return []})
 // Do not report a silently truncated slate as complete.
 if(games.length>1200)failed=true
 const values=games.map(g=>({...g,startTime:g.startTime?.toISOString()??null,fetchedAt:g.fetchedAt.toISOString(),expiresAt:g.expiresAt.toISOString()}))
 return rows.map(r=>buildWeeklyScheduleForecast(r,values,now,failed))
}
