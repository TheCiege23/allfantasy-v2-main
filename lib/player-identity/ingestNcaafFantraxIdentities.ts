import { randomUUID } from 'node:crypto'
import { planCurrentRosterCfbdLinks, currentCfbdRosterProofStart, verifiedCurrentRosterSchoolAliases } from './currentRosterCfbdLinks'
import { prisma } from '@/lib/prisma'
import { getFantraxPlayerIds } from '@/lib/league-import/fantrax/fantraxApi'
import { planNcaafFantraxIdentityLinks, verifiedFantraxSchoolAliases, currentCfbdSchoolIdentities, type CfbdSchoolFact } from './ncaafFantraxIdentityPlan'

/** Scheduled ingestion only. One provider read, one registry read and a guarded batch update. */
export async function ingestNcaafFantraxIdentities(dryRun = false, forceRefresh = false) {
  const markerKey = 'fantrax:ncaaf-identities:last-run'
  const marker = await prisma.sportsDataCache.findUnique({ where: { cacheKey: markerKey } })
  const last = marker?.data && typeof marker.data === 'object' && !Array.isArray(marker.data) ? (marker.data as Record<string, unknown>).at : null
  if (!dryRun && !forceRefresh && typeof last === 'string' && Date.now() - Date.parse(last) < 7 * 86400000) return { skipped: 'weekly cadence', updated: 0 }
  const map = await getFantraxPlayerIds('CFB')
  if (!map.ok) throw new Error(map.failure.message)
  const registryRows = await prisma.playerIdentityMap.findMany({ where: { sport: { in: ['NCAAF','NCAAFB'] } }, select: { id: true, canonicalName: true, currentTeam: true, position: true, fantraxId: true, cfbdId: true } })
  const schedule = await prisma.sportsGame.findMany({ where: { sport: 'NCAAF', source: 'cfbd', season: new Date().getUTCFullYear(), seasonType: 'regular' }, select: { homeTeam: true, awayTeam: true } })
  const schools = [...new Set(schedule.flatMap(game => [game.homeTeam, game.awayTeam]).filter((team): team is string => Boolean(team)))]
  if (!schools.length) throw new Error('Current CFBD school schedule is unavailable; refusing college identity writes')
  const facts = await prisma.$queryRaw<CfbdSchoolFact[]>`
    SELECT DISTINCT "playerId" AS "cfbdId", stat_payload->>'name' AS name, stat_payload->>'_team' AS school
    FROM player_game_stats WHERE "sportType" IN ('NCAAF','NCAAFB') AND "gameId" LIKE 'cfbd:%' AND (source='cfbd-weekly' OR source IS NULL)
    AND season=${new Date().getUTCFullYear()} AND stat_payload->>'name' IS NOT NULL AND stat_payload->>'_team' IS NOT NULL
  `
  const rows = currentCfbdSchoolIdentities(registryRows, facts, schools)
  const aliases = verifiedFantraxSchoolAliases(Object.values(map.data), rows, facts, schools)
  const { links, ...coverage } = planNcaafFantraxIdentityLinks(Object.values(map.data), rows, schools, aliases)
  const updated = dryRun || !links.length ? 0 : await prisma.$executeRaw`
    WITH links AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(links)}::jsonb) AS l(id text, "fantraxId" text, "cfbdId" text))
    UPDATE "PlayerIdentityMap" p SET "fantraxId"=l."fantraxId", "updatedAt"=NOW(), "lastSyncedAt"=NOW()
    FROM links l WHERE p.id=l.id AND p.sport IN ('NCAAF','NCAAFB') AND p."fantraxId" IS NULL AND p."cfbdId"=l."cfbdId"
    AND NOT EXISTS (SELECT 1 FROM "PlayerIdentityMap" other WHERE other.sport IN ('NCAAF','NCAAFB') AND other."fantraxId"=l."fantraxId")
  `
  const stateRow = await prisma.sportsDataCache.findUnique({where:{cacheKey:'cfbd-roster-pool:v1'},select:{data:true}})
  const year = new Date().getUTCFullYear()
  const started = currentCfbdRosterProofStart(stateRow?.data)
  const currentProof = started!==null
  const pool = currentProof ? await prisma.sportsPlayer.findMany({where:{sport:'NCAAF',source:'cfbd',status:'active',fetchedAt:{gte:started!},expiresAt:{gt:new Date()}},select:{externalId:true,name:true,position:true,college:true,team:true}}) : []
  const poolFacts = pool.map(p=>({cfbdId:p.externalId,name:p.name,school:p.college??p.team??''}))
  const rosterAliases = verifiedFantraxSchoolAliases(Object.values(map.data),currentCfbdSchoolIdentities(registryRows,poolFacts,schools),poolFacts,schools)
  const bootstrapAliases = verifiedCurrentRosterSchoolAliases(Object.values(map.data),pool)
  const agreedAliases:Record<string,string> = {}
  const claims=new Map<string,Set<string>>()
  for(const learned of [aliases,rosterAliases,bootstrapAliases])for(const [code,school] of Object.entries(learned)){const schools=claims.get(code)??new Set<string>();schools.add(school);claims.set(code,schools)}
  for(const [code,schools] of claims)if(schools.size===1)agreedAliases[code]=[...schools][0]!
  const imported = await prisma.redraftRosterPlayer.findMany({where:{droppedAt:null,roster:{is:{season:{is:{season:year,sport:{in:['NCAAF','NCAAFB']},league:{is:{platform:'fantrax'}}}}}}},select:{playerId:true}})
  // Base links attach the Fantrax ID first. Include them in the planner's view even during a dry run.
  const baseById = new Map(links.map(l=>[l.id,l]))
  const nextRows = registryRows.map(r=>baseById.has(r.id)?{...r,fantraxId:baseById.get(r.id)!.fantraxId}:r)
  const rosterPlan = planCurrentRosterCfbdLinks(Object.values(map.data),nextRows,pool,facts,agreedAliases,new Set(imported.map(p=>p.playerId)))
  const rosterUpdated = dryRun ? 0 : await prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fantrax:ncaaf-current-roster-links'))`
    let count=0
    for(const link of rosterPlan.links){
      count+=await tx.$executeRaw`UPDATE "PlayerIdentityMap" p SET "cfbdId"=${link.cfbdId}, "updatedAt"=NOW(), "lastSyncedAt"=NOW() WHERE p.id=${link.id} AND p.sport IN ('NCAAF','NCAAFB') AND p."fantraxId"=${link.fantraxId} AND p."cfbdId" IS NULL AND p."canonicalName"=${link.name} AND p.position IS NOT DISTINCT FROM ${link.position} AND NOT EXISTS (SELECT 1 FROM "PlayerIdentityMap" other WHERE other.sport IN ('NCAAF','NCAAFB') AND other.id<>p.id AND (other."fantraxId"=${link.fantraxId} OR (other."cfbdId"=${link.cfbdId} AND other."fantraxId" IS NOT NULL AND other."fantraxId"<>${link.fantraxId})))`
    }
    for(const link of rosterPlan.sourceLinks){
      count+=await tx.$executeRaw`UPDATE "PlayerIdentityMap" p SET "fantraxId"=${link.fantraxId}, "updatedAt"=NOW(), "lastSyncedAt"=NOW() WHERE p.id=${link.id} AND p.sport IN ('NCAAF','NCAAFB') AND p."fantraxId" IS NULL AND p."cfbdId"=${link.cfbdId} AND NOT EXISTS (SELECT 1 FROM "PlayerIdentityMap" other WHERE other.sport IN ('NCAAF','NCAAFB') AND other.id<>p.id AND (other."fantraxId"=${link.fantraxId} OR other."cfbdId"=${link.cfbdId}))`
    }
    for(const seed of rosterPlan.creates){
      count+=await tx.$executeRaw`INSERT INTO "PlayerIdentityMap" (id,sport,"canonicalName","normalizedName",position,"currentTeam","fantraxId","cfbdId","createdAt","updatedAt","lastSyncedAt") SELECT ${randomUUID()},'NCAAF',${seed.canonicalName},${seed.normalizedName},${seed.position},${seed.currentTeam},${seed.fantraxId},${seed.cfbdId},NOW(),NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM "PlayerIdentityMap" WHERE sport IN ('NCAAF','NCAAFB') AND ("fantraxId"=${seed.fantraxId} OR "cfbdId"=${seed.cfbdId}))`
    }
    return count
  },{timeout:60000,isolationLevel:'Serializable'})
  const result = { ...coverage, currentRosterProof:currentProof, rosterProposed:rosterPlan.links.length+rosterPlan.sourceLinks.length+rosterPlan.creates.length, rosterUpdated, rosterAmbiguous:rosterPlan.ambiguous, rosterConflicts:rosterPlan.conflicts, schoolAliasesVerified: Object.keys(aliases).length, proposed: links.length, updated, dryRun }
  if (!dryRun) {
    const data = { at: new Date().toISOString(), ...result }
    const expiresAt = new Date(Date.now() + 30 * 86400000)
    await prisma.sportsDataCache.upsert({ where: { cacheKey: markerKey }, create: { cacheKey: markerKey, data, expiresAt }, update: { data, expiresAt } })
  }
  return result
}
