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
import {verifiedSourceZero,reviewedGameStats} from './fantraxScoreEvidence'
import type {Prisma} from '@prisma/client'

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
    const receipts=await prisma.sportsDataCache.findMany({where:{cacheKey:{startsWith:`fantrax-actuals-receipt:${league.platformLeagueId}:${league.season}:${period.number}:`}},select:{data:true},take:101})
    const review=await prisma.sportsDataCache.findUnique({where:{cacheKey:`fantrax-score-review:${leagueId}:${league.season}:${period.number}`},select:{data:true}})
    const ids=actuals.map(p=>p.playerId), bridge=await bridgeNcaafRosterIdsToCfbdIds(prisma as never,ids,'fantrax')
    const identities=await prisma.playerIdentityMap.findMany({where:{sport:{in:['NCAAF','NCAAFB']},fantraxId:{in:ids}},select:{fantraxId:true,canonicalName:true,position:true}})
    const stats=await prisma.playerGameStat.findMany({where:{sportType:'NCAAF',season:league.season,playerId:{in:bridge.cfbdIds},gameDate:{gte:new Date(period.startDate.slice(0,10)),lte:new Date(period.endDate.slice(0,10))}},select:{playerId:true,gameId:true,normalizedStatMap:true,source:true},take:10001})
    if(stats.length>10000)throw new Error('Fantrax stat comparison exceeds tick budget')
    const calculated=new Map<string,number>()
    const reviewed=new Map<string,{kind:string;reviewedPoints:number;evidence:NonNullable<ReturnType<typeof reviewedGameStats>>[]}>()
    const gapReason=new Map(ids.map(id=>[id,'identity_unresolved']))
    for(const id of bridge.cfbdIds) {
      const rosterId=bridge.rosterIdFor(id), rows=stats.filter(p=>p.playerId===id)
      if(!rosterId)continue
      gapReason.set(rosterId,'provider_game_rows_missing')
      if(!rows.length)continue // Unknown stats and byes remain explicit coverage gaps.
      const identity=identities.find(p=>p.fantraxId===rosterId)
      gapReason.set(rosterId,'identity_position_missing')
      if(!identity?.position)continue
      const aggregate=aggregateNcaafWeek(rows.map(p=>p.normalizedStatMap))
      gapReason.set(rosterId,aggregate.unmappedKeys.length?'unmapped_provider_stats':'provider_appearance_unverified')
      if(aggregate.unmappedKeys.length || !aggregate.gamesCounted)continue
      const normalized=aggregate.stats
      calculated.set(rosterId,scoreStatsWithCategories(rules.categories,{...normalized,te_premium:identity.position==='TE'?(normalized.rec??0):0},rules.overrides))
      const corrections=rows.map(row=>reviewedGameStats(row.normalizedStatMap,{playerId:rosterId,gameId:row.gameId},(review?.data as any)?.reviews))
      if(corrections.some(Boolean)){
        const corrected=aggregateNcaafWeek(rows.map((row,index)=>corrections[index]?.stats??row.normalizedStatMap))
        const reviewedPoints=scoreStatsWithCategories(rules.categories,{...corrected.stats,te_premium:identity.position==='TE'?(corrected.stats.rec??0):0},rules.overrides)
        if(!corrected.unmappedKeys.length && corrected.gamesCounted===aggregate.gamesCounted && Math.abs(reviewedPoints-(actuals.find(a=>a.playerId===rosterId)?.points??NaN))<=.001)reviewed.set(rosterId,{kind:'official_stat_conflict',reviewedPoints,evidence:corrections.filter((c):c is NonNullable<typeof c>=>c!==null)})
      }
    }
    const rows=compareFantraxActuals(actuals.map(p=>({...p,name:identities.find(i=>i.fantraxId===p.playerId)?.canonicalName??p.playerId})),calculated).map(row=>{
      const sourceEvidence=row.status==='missing_calculation'?verifiedSourceZero(receipts,{...row,rosterId:actuals.find(a=>a.playerId===row.playerId)?.rosterId??null,period:period.number}):null
      const resolution=row.status==='discrepancy'?reviewed.get(row.playerId)??null:null
      return {...row,coverageGap:row.status==='missing_calculation'?gapReason.get(row.playerId)??'calculation_unavailable':null,sourceEvidence,resolution,requiresReview:row.status!=='matched' && !sourceEvidence && !resolution}
    })
    compared+=rows.filter(p=>p.status!=='missing_calculation').length
    discrepancies+=rows.filter(p=>p.status==='discrepancy').length
    gaps+=rows.filter(p=>p.status==='missing_calculation').length
    const data={source:'fantrax',season:league.season,period:period.number,comparedAt:now.toISOString(),rows,sourceVerifiedZeros:rows.filter(r=>r.sourceEvidence).length,reviewedDiscrepancies:rows.filter(r=>r.resolution).length,unresolved:rows.filter(r=>r.requiresReview).length,providerSources:[...new Set(stats.map(p=>p.source))],policy:'report-only; source actuals and calculated stats preserved; source zero evidence is not independent provider parity'}
    const cacheKey=`fantrax-scoring-parity:${leagueId}:${league.season}:${period.number}`
    const persisted=JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue
    await prisma.sportsDataCache.upsert({where:{cacheKey},create:{cacheKey,data:persisted,expiresAt:new Date(now.getTime()+7*86400000)},update:{data:persisted,expiresAt:new Date(now.getTime()+7*86400000)}})
  }
  return {compared,discrepancies,gaps}
}
