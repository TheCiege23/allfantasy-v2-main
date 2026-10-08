/** Operator bulk import. Default is dry-run; CSVs are matched to live period evidence.
 * Usage: node --conditions=react-server --import tsx scripts/import-fantrax-weekly-actuals.ts --manifest=PATH [--apply]
 * Manifest: { leagueId: AllFantasy league UUID, season: 2026,
 *   exports: [{period:4, sourceTeamId: Fantrax team id, path: CSV path}] }
 * Writes only league-scoped SOURCE actuals, never global stats or published team results.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { getFantraxLeagueInfo, getFantraxMatchupScores, getFantraxTeamRosters } from '../lib/league-import/fantrax/fantraxApi'
import { normalizeFantraxTeamName } from '../lib/league-import/fantrax/fantraxTeamIds'
import { verifyFantraxWeeklyActuals, fantraxActualWriteDecision } from '../lib/league-import/fantrax/fantraxWeeklyActuals'

async function main() {
  const manifestPath = process.argv.find(a => a.startsWith('--manifest='))?.slice(11)
  if (!manifestPath) throw new Error('--manifest required')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { leagueId: string; season: number; exports: Array<{period:number;sourceTeamId:string;path:string}> }
  if (!Number.isInteger(manifest.season) || !Array.isArray(manifest.exports) || !manifest.exports.length || manifest.exports.length > 400) throw new Error('Invalid manifest')
  const league = await prisma.league.findUnique({ where: { id: manifest.leagueId }, select: { platform:true, platformLeagueId:true, season:true, userId:true } })
  if (league?.platform !== 'fantrax' || !league.platformLeagueId || league.season !== manifest.season) throw new Error('League/season mismatch')
  const snapshot = await prisma.fantraxLeague.findUnique({ where: { id: league.platformLeagueId }, select: { sourceLeagueId:true, appUserId:true } })
  if (!snapshot?.sourceLeagueId || snapshot.appUserId !== league.userId) throw new Error('Source league ownership missing')
  const info = await getFantraxLeagueInfo(snapshot.sourceLeagueId)
  if (!info.ok || Number(info.data.seasonYear) !== manifest.season) throw new Error('Source season unavailable or mismatch')
  const teams = await prisma.leagueTeam.findMany({ where:{leagueId:manifest.leagueId},select:{externalId:true,teamName:true,ownerName:true} })
  const planned: Array<{week:number;playerId:string;rosterId:number;isStarter:boolean;points:number;sha256:string;sourceTeamId:string}> = []
  const seenPlayers = new Set<string>(), seenExports = new Set<string>()
  for (const period of [...new Set(manifest.exports.map(e=>e.period))]) {
    const end = info.data.scoringPeriods?.find(p=>p.number===period)?.endDate
    if (!Number.isInteger(period) || period < 1 || !end || !Number.isFinite(Date.parse(end)) || Date.parse(end) >= Date.now()) throw new Error('Only completed source periods may be imported')
    const rosters = await getFantraxTeamRosters(snapshot.sourceLeagueId, period)
    const scores = await getFantraxMatchupScores(snapshot.sourceLeagueId, period)
    if (!rosters.ok || !scores.ok || scores.data.period !== period) throw new Error('Period evidence unavailable')
    for (const entry of manifest.exports.filter(e=>e.period===period)) {
      const key = `${period}:${entry.sourceTeamId}`
      if(seenExports.has(key)) throw new Error('Duplicate team-period export')
      seenExports.add(key)
      const roster = rosters.data[entry.sourceTeamId]
      const sides = scores.data.matchups.flatMap(m=>[m.home,m.away]).filter(s=>s.teamId===entry.sourceTeamId)
      if (!roster || sides.length !== 1 || sides[0]!.gamesPlayed <= 0) throw new Error('Source team result missing or ambiguous')
      const matches = teams.filter(t=>/^\d+$/.test(String(t.externalId)) && normalizeFantraxTeamName(t.teamName||t.ownerName||'')===normalizeFantraxTeamName(roster.teamName))
      const rosterId = Number(matches[0]?.externalId)
      if(matches.length!==1 || !/^\d+$/.test(String(matches[0]?.externalId)) || !Number.isInteger(rosterId) || rosterId<=0 || rosterId>2147483647) throw new Error('Stored roster mapping missing or ambiguous')
      const csv = readFileSync(entry.path, 'utf8'), sha256 = createHash('sha256').update(csv).digest('hex')
      const verified = verifyFantraxWeeklyActuals({csv,sourceTeamId:entry.sourceTeamId,roster,sourceTotal:sides[0]!.score})
      for(const player of verified.players) {
        const key = `${period}:${player.playerId}`
        if(seenPlayers.has(key)) throw new Error('Player appears on multiple teams in the period')
        seenPlayers.add(key)
        planned.push({week:period,playerId:player.playerId,rosterId,isStarter:player.isStarter,points:player.points,sha256,sourceTeamId:entry.sourceTeamId})
      }
    }
  }
  // Validate the whole batch before any write. Keep finalized rows immutable.
  let written=0, unchanged=0
  const before = await prisma.leaguePlayerWeeklyScore.findMany({where:{leagueId:league.platformLeagueId,seasonYear:manifest.season,week:{in:[...new Set(planned.map(p=>p.week))]},playerId:{in:[...new Set(planned.map(p=>p.playerId))]}}})
  const plannedWrites = planned.filter(row=>fantraxActualWriteDecision(row,before.find(p=>p.week===row.week&&p.playerId===row.playerId))==='write').length
  if(process.argv.includes('--apply')) writeFileSync(manifestPath+'.before-'+Date.now()+'.json',JSON.stringify(before,null,2),{flag:'wx'})
  if(process.argv.includes('--apply')) await prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fantrax-actuals:${league.platformLeagueId}:${manifest.season}`}))`
    for(const row of planned) {
      const key={leagueId:league.platformLeagueId!,seasonYear:manifest.season,week:row.week,playerId:row.playerId}
      const prior=await tx.leaguePlayerWeeklyScore.findUnique({where:{leagueId_seasonYear_week_playerId:key}})
      if(fantraxActualWriteDecision(row,prior)==='unchanged'){unchanged++;continue}
      const data={points:row.points,rosterId:row.rosterId,isStarter:row.isStarter,source:'fantrax'}
      await tx.leaguePlayerWeeklyScore.upsert({where:{leagueId_seasonYear_week_playerId:key},create:{...key,...data},update:data})
      written++
    }
    for(const entry of manifest.exports) {
      const key=`fantrax-actuals-receipt:${league.platformLeagueId}:${manifest.season}:${entry.period}:${entry.sourceTeamId}`
      const data={importedAt:new Date().toISOString(),period:entry.period,sourceTeamId:entry.sourceTeamId,sha256:planned.find(p=>p.week===entry.period&&p.sourceTeamId===entry.sourceTeamId)!.sha256,rows:planned.filter(p=>p.week===entry.period&&p.sourceTeamId===entry.sourceTeamId).length,transport:'operator-csv',verified:true}
      await tx.sportsDataCache.upsert({where:{cacheKey:key},create:{cacheKey:key,data,expiresAt:new Date(Date.now()+365*86400000)},update:{data,expiresAt:new Date(Date.now()+365*86400000)}})
    }
  },{timeout:120000})
  console.log(JSON.stringify({mode:process.argv.includes('--apply')?'apply':'dry-run',verifiedRows:planned.length,verifiedTeamPeriods:seenExports.size,plannedWrites,written,unchanged}))
}
main().catch((error: unknown)=>{const message=error instanceof Error?error.message:'';console.error(message.length<120 && !/postgres|https?:|@/i.test(message)?message:'Fantrax actuals import aborted; source or database unavailable.');process.exitCode=1}).finally(()=>prisma.$disconnect())
