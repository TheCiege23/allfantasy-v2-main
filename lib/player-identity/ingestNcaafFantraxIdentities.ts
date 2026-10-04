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
  const result = { ...coverage, schoolAliasesVerified: Object.keys(aliases).length, proposed: links.length, updated, dryRun }
  if (!dryRun) {
    const data = { at: new Date().toISOString(), ...result }
    const expiresAt = new Date(Date.now() + 30 * 86400000)
    await prisma.sportsDataCache.upsert({ where: { cacheKey: markerKey }, create: { cacheKey: markerKey, data, expiresAt }, update: { data, expiresAt } })
  }
  return result
}
