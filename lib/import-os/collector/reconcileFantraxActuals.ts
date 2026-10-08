/** DB-first comparison sidecar for the existing Fantrax background collector.
 * Source points and provider stats remain immutable; cache receipts expose discrepancies. */
import { prisma } from '@/lib/prisma'
import { bridgeNcaafRosterIdsToCfbdIds } from '@/lib/redraft/ncaafGameLogIdBridge'
import { aggregateNcaafWeek, isNcaafSport } from '@/lib/scoring-runtime/ncaafStatNormalization'
import { importedNcaafScoring } from '@/lib/redraft/importedNcaafScoring'
import { scoreStatsWithCategories } from '@/lib/redraft/scoringEngine'
import { NCAAF_CONFIG } from '@/lib/sportConfig/configs/ncaaf'
import { compareFantraxActuals } from '@/lib/league-import/fantrax/fantraxWeeklyActuals'
import type { FantraxLeagueInfo } from '@/lib/league-import/fantrax/fantraxApi'

export async function reconcileFantraxActuals(leagueId: string, info: FantraxLeagueInfo, now = new Date()) {
  const league = await prisma.league.findUnique({where:{id:leagueId},select:{platform:true,platformLeagueId:true,season:true,sport:true,settings:true}})
  if(league?.platform !== 'fantrax' || !league.platformLeagueId || !isNcaafSport(String(league.sport)) || league.season !== Number(info.seasonYear)) return {compared:0,discrepancies:0,gaps:0}
  const rules=importedNcaafScoring('NCAAF',league.settings,NCAAF_CONFIG.scoringCategories)
  if(!rules) return {compared:0,discrepancies:0,gaps:0}
  const periods=(info.scoringPeriods??[]).filter(p=>p.endDate && Date.parse(p.endDate)<now.getTime()).sort((a,b)=>b.number-a.number).slice(0,2)
  let compared=0,discrepancies=0,gaps=0
  for(const period of periods) {
    if(!period.startDate || !period.endDate)continue
    const actuals=await prisma.leaguePlayerWeeklyScore.findMany({where:{leagueId:league.platformLeagueId,seasonYear:league.season,week:period.number,source:'fantrax',isStarter:true},select:{playerId:true,points:true,rosterId:true,isStarter:true},take:1001})
    if(!actuals.length)continue
    if(actuals.length>1000)throw new Error('Fantrax actual comparison exceeds tick budget')
    const ids=actuals.map(p=>p.playerId), bridge=await bridgeNcaafRosterIdsToCfbdIds(prisma as never,ids,'fantrax')
    const identities=await prisma.playerIdentityMap.findMany({where:{sport:{in:['NCAAF','NCAAFB']},fantraxId:{in:ids}},select:{fantraxId:true,canonicalName:true,position:true}})
    const stats=await prisma.playerGameStat.findMany({where:{sportType:'NCAAF',season:league.season,playerId:{in:bridge.cfbdIds},gameDate:{gte:new Date(period.startDate.slice(0,10)),lte:new Date(period.endDate.slice(0,10))}},select:{playerId:true,gameId:true,normalizedStatMap:true,source:true},take:10001})
    if(stats.length>10000)throw new Error('Fantrax stat comparison exceeds tick budget')
    const calculated=new Map<string,number>()
    for(const id of bridge.cfbdIds) {
      const rosterId=bridge.rosterIdFor(id), rows=stats.filter(p=>p.playerId===id)
      if(!rosterId || !rows.length)continue // Unknown stats and byes remain explicit coverage gaps.
      const identity=identities.find(p=>p.fantraxId===rosterId)
      if(!identity?.position)continue
      const normalized=aggregateNcaafWeek(rows.map(p=>p.normalizedStatMap)).stats
      calculated.set(rosterId,scoreStatsWithCategories(rules.categories,{...normalized,te_premium:identity.position==='TE'?(normalized.rec??0):0},rules.overrides))
    }
    const rows=compareFantraxActuals(actuals.map(p=>({...p,name:identities.find(i=>i.fantraxId===p.playerId)?.canonicalName??p.playerId})),calculated)
    compared+=rows.filter(p=>p.status!=='missing_calculation').length
    discrepancies+=rows.filter(p=>p.status==='discrepancy').length
    gaps+=rows.filter(p=>p.status==='missing_calculation').length
    const data={source:'fantrax',season:league.season,period:period.number,comparedAt:now.toISOString(),rows,providerSources:[...new Set(stats.map(p=>p.source))],policy:'report-only; source actuals and calculated stats preserved'}
    const cacheKey=`fantrax-scoring-parity:${leagueId}:${league.season}:${period.number}`
    await prisma.sportsDataCache.upsert({where:{cacheKey},create:{cacheKey,data,expiresAt:new Date(now.getTime()+7*86400000)},update:{data,expiresAt:new Date(now.getTime()+7*86400000)}})
  }
  return {compared,discrepancies,gaps}
}
