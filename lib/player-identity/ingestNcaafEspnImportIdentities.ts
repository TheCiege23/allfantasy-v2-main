import { prisma } from '@/lib/prisma'
import { planNcaafEspnIdentityLinks } from './ncaafEspnIdentityPlan'

/** Authorized import boundary only. Uses the roster evidence already captured by the import. */
export async function ingestNcaafEspnImportIdentities(playerMap: Record<string, { name: string; position: string; team: string }>) {
  if (!Object.keys(playerMap).length) return
  await prisma.$transaction(async (tx) => {
    // Serialize concurrent ESPN college imports before either reads the candidate registry.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ncaaf-espn-import-identities'))`
    const rows = await tx.playerIdentityMap.findMany({
      where: { sport: 'NCAAF' },
      select: { id: true, canonicalName: true, currentTeam: true, position: true, espnId: true, cfbdId: true },
    })
    const links = planNcaafEspnIdentityLinks(Object.entries(playerMap).map(([id, p]) => ({ id, ...p })), rows)
    if (!links.length) return
    await tx.$executeRaw`
      WITH links AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(links)}::jsonb) AS l(id text, "espnId" text, "cfbdId" text))
      UPDATE "PlayerIdentityMap" p SET "espnId"=l."espnId", "updatedAt"=NOW(), "lastSyncedAt"=NOW()
      FROM links l WHERE p.id=l.id AND p.sport='NCAAF' AND p."espnId" IS NULL AND p."cfbdId"=l."cfbdId"
      AND NOT EXISTS (SELECT 1 FROM "PlayerIdentityMap" other WHERE other.sport='NCAAF' AND other."espnId"=l."espnId")
    `
  })
}
