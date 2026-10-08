import {prisma} from '@/lib/prisma'
import {getFantraxLeagueInfo} from '@/lib/league-import/fantrax/fantraxApi'

/** Download contract captured from a real 2026 actual-week request. Opaque season
 * codes must be verified for each new season, never guessed from the year. */
export function fantraxActualDownloadUrl(input:{sourceLeagueId:string;sourceTeamId:string;season:number;period:number;endDate:string}) {
  if(input.season!==2026 || !/^[a-z0-9]{8,32}$/.test(input.sourceLeagueId) || !/^[a-z0-9]{8,32}$/.test(input.sourceTeamId) || !Number.isInteger(input.period) || input.period<1 || input.period>40)throw new Error('Download contract unavailable')
  if(!/^2026-\d{2}-\d{2}$/.test(input.endDate) || !Number.isFinite(Date.parse(input.endDate)) || new Date(input.endDate).toISOString().slice(0,10)!==input.endDate || input.endDate<'2026-09-01')throw new Error('Invalid date envelope')
  const query=new URLSearchParams({leagueId:input.sourceLeagueId,period:String(input.period),seasonOrProjection:'SEASON_50t_BY_PERIOD',timeframeTypeCode:'BY_PERIOD',scoringCategoryType:'5',statsType:'1',view:'STATS',teamId:input.sourceTeamId,adminMode:'false',startDate:'2026-09-01',endDate:input.endDate,lineupChangeSystem:'EASY_CLICK',daily:'false',origDaily:'false'})
  return `https://www.fantrax.com/fxpa/downloadTeamRosterStats?${query}`
}

export async function fantraxBrowserContext(userId:string,leagueId:string){
  const league=await prisma.league.findUnique({where:{id:leagueId},select:{userId:true,platform:true,platformLeagueId:true,season:true,sport:true}})
  if(league?.userId!==userId || league.platform!=='fantrax' || !league.platformLeagueId || !['NCAAF','NCAAFB'].includes(String(league.sport)))throw new Error('League unavailable')
  const snapshot=await prisma.fantraxLeague.findUnique({where:{id:league.platformLeagueId},select:{appUserId:true,sourceLeagueId:true}})
  if(snapshot?.appUserId!==userId || !snapshot.sourceLeagueId)throw new Error('League unavailable')
  const info=await getFantraxLeagueInfo(snapshot.sourceLeagueId)
  if(!info.ok || Number(info.data.seasonYear)!==league.season)throw new Error('Source season unavailable')
  const teams=Object.entries(info.data.teamInfo).map(([sourceTeamId,team])=>({sourceTeamId,name:team.name}))
  if(!teams.length || teams.length>24)throw new Error('League exceeds connector limit')
  const endDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  const periods=(info.data.scoringPeriods??[]).filter(p=>p.startDate && p.endDate && p.startDate.slice(0,10)>='2026-09-01' && p.endDate.slice(0,10)<=endDate && Date.parse(p.endDate)<Date.now()).map(p=>({period:p.number,startDate:p.startDate,endDate:p.endDate,downloads:teams.map(t=>({...t,url:fantraxActualDownloadUrl({sourceLeagueId:snapshot.sourceLeagueId!,sourceTeamId:t.sourceTeamId,season:league.season!,period:p.number,endDate})}))}))
  if(!periods.length)throw new Error('No completed periods in the verified download contract')
  return {leagueId,season:league.season,sourceLeagueId:snapshot.sourceLeagueId,leagueName:info.data.leagueName,periods,verifiedSeason:2026,mode:'browser-session'}
}
