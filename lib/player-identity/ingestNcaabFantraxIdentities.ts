import { prisma } from '@/lib/prisma'
import { getFantraxPlayerIds } from '@/lib/league-import/fantrax/fantraxApi'
import { planNcaabFantraxIdentityLinks } from './ncaabFantraxIdentityPlan'

/** Weekly, additive bridge for Fantrax college basketball rosters. Dry runs never write. */
export async function ingestNcaabFantraxIdentities(dryRun = false) {
  const markerKey = 'fantrax:ncaab-identities:last-run'
  const marker = await prisma.sportsDataCache.findUnique({ where: { cacheKey: markerKey } })
  const last = marker?.data && typeof marker.data === 'object' && !Array.isArray(marker.data)
    ? (marker.data as Record<string, unknown>).at : null
  if (!dryRun && typeof last === 'string' && Date.now() - Date.parse(last) < 7 * 86400000) {
    return { skipped: 'weekly cadence', proposed: 0, updated: 0 }
  }

  const map = await getFantraxPlayerIds('NCAAB')
  if (!map.ok) throw new Error(map.failure.message)
  const [identities, sourcePlayers, teams, rosterRows] = await Promise.all([
    prisma.playerIdentityMap.findMany({ where: { sport: 'NCAAB' },
      select: { id: true, normalizedName: true, position: true, currentTeam: true,
        rollingInsightsId: true, fantraxId: true } }),
    prisma.sportsPlayer.findMany({ where: { sport: 'NCAAB', source: 'rolling_insights' },
      select: { externalId: true, name: true, position: true, team: true } }),
    prisma.sportsTeam.findMany({ where: { sport: 'NCAAB' }, select: { name: true, shortName: true } }),
    prisma.$queryRaw<Array<{ player_id: string }>>`
      SELECT DISTINCT e.value #>> '{}' AS player_id
      FROM leagues l JOIN rosters r ON r."leagueId"=l.id
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r."playerData"->'players','[]'::jsonb)) e(value)
      WHERE l.sport::text='NCAAB' AND l.platform='fantrax'`,
  ])
  const plan = planNcaabFantraxIdentityLinks({ refs: Object.values(map.data), identities,
    sourcePlayers, teams, rosterIds: new Set(rosterRows.map(row => row.player_id)) })
  const updated = dryRun || !plan.links.length ? 0 : await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fantrax:ncaab-identity-links'))`
    return tx.$executeRaw`
      WITH links AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(plan.links)}::jsonb)
        AS l(id text, "fantraxId" text, "rollingInsightsId" text))
      UPDATE "PlayerIdentityMap" p SET "fantraxId"=l."fantraxId", "updatedAt"=NOW(), "lastSyncedAt"=NOW()
      FROM links l WHERE p.id=l.id AND p.sport='NCAAB' AND p."fantraxId" IS NULL
        AND p."rollingInsightsId"=l."rollingInsightsId"
        AND NOT EXISTS (SELECT 1 FROM "PlayerIdentityMap" other WHERE other.sport='NCAAB'
          AND other."fantraxId"=l."fantraxId")`
  }, { timeout: 60000, isolationLevel: 'Serializable' })
  const result = { provided: Object.keys(map.data).length, rostered: rosterRows.length,
    proposed: plan.links.length, updated, ambiguous: plan.ambiguous, conflicts: plan.conflicts, dryRun }
  if (!dryRun) {
    const data = { at: new Date().toISOString(), ...result }
    const expiresAt = new Date(Date.now() + 30 * 86400000)
    await prisma.sportsDataCache.upsert({ where: { cacheKey: markerKey },
      create: { cacheKey: markerKey, data, expiresAt }, update: { data, expiresAt } })
  }
  return result
}
