import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { prisma } from '@/lib/prisma'
import { nativeCategoryScoringContext } from '@/lib/category-scoring/nativeCategoryScoringContext'
import { daysInWindow } from '@/lib/redraft/dailyLineups'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { object, periodDays, readCutover } from '@/lib/league-import/fantrax/cutoverPolicy'

export async function GET(_req:Request,{params}:{params:Promise<{leagueId:string}>}){
  const session=await getServerSession(authOptions as never) as {user?:{id?:string}} | null
  if(!session?.user?.id)return new Response(null,{status:401})
  const {leagueId}=await params
  try{await assertCommissionerAccess(leagueId,session.user.id,'league')}catch{return new Response(null,{status:403})}
  const league=await prisma.league.findUniqueOrThrow({where:{id:leagueId},select:{sport:true,season:true,settings:true}})
  const cut=readCutover(league.settings,league.season??-1)
  if(!cut?.installedSeasonId || cut.settled || cut.policy!=='reconcile_open_period')return new Response(null,{status:409})
  const category=nativeCategoryScoringContext(league.settings,String(league.sport))
  const keys=[...new Set(category?.categories.flatMap(c=>c.computation.kind==='sum'?[c.computation.statKey]:[c.computation.numeratorStatKey,c.computation.denominatorStatKey,...(c.computation.additionalNumeratorStatKeys??[])])??[])]
  const fixtures=await prisma.redraftMatchup.findMany({where:{seasonId:cut.installedSeasonId,week:cut.period}})
  const teams=new Map<string,string>()
  for(const m of fixtures){const s=object(object(m.lineupSnapshots).fantraxCutover);teams.set(m.homeRosterId,s.homeTeam);if(m.awayRosterId)teams.set(m.awayRosterId,s.awayTeam)}
  const roster=await prisma.redraftRosterPlayer.findMany({where:{roster:{seasonId:cut.installedSeasonId},droppedAt:null},orderBy:[{rosterId:'asc'},{playerId:'asc'}],select:{rosterId:true,playerId:true}})
  const playerIds=roster.map(p=>p.playerId)
  const column=league.sport==='NFL'?'sleeperId':'rollingInsightsId'
  const ids=await prisma.playerIdentityMap.findMany({where:{sport:league.sport,[column]:{in:playerIds}},select:{fantraxId:true,rollingInsightsId:true,sleeperId:true}})
  const fan=new Map(ids.map(p=>[p[column],p.fantraxId]))
  const csv=[['season','period','team_id','player_id','date','slot','points',...keys.map(k=>'stat.'+k)].join(',')]
  const today=easternCalendarDay(new Date())!
  for(const d of daysInWindow(periodDays(cut.periods[cut.period-1])).filter(d=>d<=today))for(const p of roster){
    const team=teams.get(p.rosterId), player=fan.get(p.playerId)
    if(!team || !player || !/^[a-z0-9]+$/i.test(team) || !/^[a-z0-9]+$/i.test(player))return new Response('Verify source roster identities before downloading a template.',{status:409})
    csv.push([cut.season,cut.period,team,player,d.toISOString().slice(0,10),'','',...keys.map(()=>'')].join(','))
  }
  return new Response(csv.join('\r\n'),{headers:{'content-type':'text/csv; charset=utf-8','cache-control':'private, no-store','content-disposition':'attachment; filename="fantrax-period-'+cut.period+'.csv"'}})
}
