import { prisma } from '@/lib/prisma'
import { getFantraxPlayerIds } from '@/lib/league-import/fantrax/fantraxApi'
import { planMlbFantraxIdentityLinks } from './mlbFantraxIdentityPlan'

/** Scheduled ingestion only. One provider read, one registry read and a guarded batch update. */
export async function ingestMlbFantraxIdentities(dryRun = false) {
  const markerKey = 'fantrax:mlb-identities:last-run'
  const marker = await prisma.sportsDataCache.findUnique({ where: { cacheKey: markerKey } })
  const last = marker?.data && typeof marker.data === 'object' && !Array.isArray(marker.data) ? (marker.data as Record<string, unknown>).at : null
  if (!dryRun && typeof last === 'string' && Date.now() - Date.parse(last) < 7 * 86400000) return { skipped: 'weekly cadence', updated: 0 }
  const map = await getFantraxPlayerIds('MLB')
  if (!map.ok) throw new Error(map.failure.message)
  const rows = await prisma.playerIdentityMap.findMany({ where: { sport: 'MLB' }, select: { id: true, canonicalName: true, currentTeam: true, position: true, fantraxId: true, rollingInsightsId: true } })
  const { links, ...coverage } = planMlbFantraxIdentityLinks(Object.values(map.data), rows)
  const updated = dryRun || !links.length ? 0 : await prisma.$executeRaw`
    WITH links AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(links)}::jsonb) AS l(id text, "fantraxId" text, "rollingInsightsId" text))
    UPDATE "PlayerIdentityMap" p SET "fantraxId"=l."fantraxId", "updatedAt"=NOW(), "lastSyncedAt"=NOW()
    FROM links l WHERE p.id=l.id AND p.sport='MLB' AND p."fantraxId" IS NULL AND p."rollingInsightsId"=l."rollingInsightsId"
    AND NOT EXISTS (SELECT 1 FROM "PlayerIdentityMap" other WHERE other.sport='MLB' AND other."fantraxId"=l."fantraxId")
  `
  const result = { ...coverage, proposed: links.length, updated, dryRun }
  if (!dryRun) {
    const data = { at: new Date().toISOString(), ...result }
    const expiresAt = new Date(Date.now() + 30 * 86400000)
    await prisma.sportsDataCache.upsert({ where: { cacheKey: markerKey }, create: { cacheKey: markerKey, data, expiresAt }, update: { data, expiresAt } })
  }
  return result
}
