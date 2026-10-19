import { prisma } from '@/lib/prisma'
import { getFantraxPlayerIds } from '@/lib/league-import/fantrax/fantraxApi'
import { planProFantraxIdentityLinks, type ProFantraxSport } from './proFantraxIdentityPlan'

/**
 * Scheduled ingestion only. One provider read, one registry read and a guarded batch update.
 *
 * The MLB job (`ingestMlbFantraxIdentities`) generalised by sport. Each sport keeps its own weekly
 * cadence marker, so a slow NBA run can never skip the MLB one or the reverse.
 *
 * ⚠ THE UPDATE IS ADDITIVE AND RE-CHECKED IN SQL: it only fills a NULL `fantraxId`, only on the row
 * whose `rollingInsightsId` the plan matched, and never when another row of the same sport already
 * carries that Fantrax id. A plan computed from a stale read cannot overwrite anything.
 */
export async function ingestProFantraxIdentities(sport: ProFantraxSport, dryRun = false) {
  const markerKey = `fantrax:${sport.toLowerCase()}-identities:last-run`
  const marker = await prisma.sportsDataCache.findUnique({ where: { cacheKey: markerKey } })
  const last = marker?.data && typeof marker.data === 'object' && !Array.isArray(marker.data) ? (marker.data as Record<string, unknown>).at : null
  if (!dryRun && typeof last === 'string' && Date.now() - Date.parse(last) < 7 * 86400000) return { skipped: 'weekly cadence', updated: 0 }
  const map = await getFantraxPlayerIds(sport)
  if (!map.ok) throw new Error(map.failure.message)
  const rows = await prisma.playerIdentityMap.findMany({ where: { sport }, select: { id: true, canonicalName: true, currentTeam: true, position: true, fantraxId: true, rollingInsightsId: true } })
  const { links, ...coverage } = planProFantraxIdentityLinks(sport, Object.values(map.data), rows)
  const updated = dryRun || !links.length ? 0 : await prisma.$executeRaw`
    WITH links AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(links)}::jsonb) AS l(id text, "fantraxId" text, "rollingInsightsId" text))
    UPDATE "PlayerIdentityMap" p SET "fantraxId"=l."fantraxId", "updatedAt"=NOW(), "lastSyncedAt"=NOW()
    FROM links l WHERE p.id=l.id AND p.sport=${sport} AND p."fantraxId" IS NULL AND p."rollingInsightsId"=l."rollingInsightsId"
    AND NOT EXISTS (SELECT 1 FROM "PlayerIdentityMap" other WHERE other.sport=${sport} AND other."fantraxId"=l."fantraxId")
  `
  const result = { ...coverage, proposed: links.length, updated, dryRun }
  if (!dryRun) {
    const data = { at: new Date().toISOString(), ...result }
    const expiresAt = new Date(Date.now() + 30 * 86400000)
    await prisma.sportsDataCache.upsert({ where: { cacheKey: markerKey }, create: { cacheKey: markerKey, data, expiresAt }, update: { data, expiresAt } })
  }
  return result
}

export const ingestNbaFantraxIdentities = (dryRun = false) => ingestProFantraxIdentities('NBA', dryRun)
export const ingestNhlFantraxIdentities = (dryRun = false) => ingestProFantraxIdentities('NHL', dryRun)
