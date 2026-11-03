import { prisma } from '@/lib/prisma'
import type { FantraxPlayerRef } from '@/lib/league-import/fantrax/fantraxApi'
import { fantraxNflNameKey, planNflFantraxIdentityLinks } from './nflFantraxIdentityPlan'

/**
 * Link the Fantrax NFL ids one import received to `PlayerIdentityMap` rows.
 *
 * Called by `importFantraxLeague` for an NFL league, with the refs the import already fetched
 * (`getPlayerIds?sport=NFL`) for the players it rosters or drafted. NO PROVIDER CALL here: the
 * import is the ingestion step, and this is its registry write.
 *
 * ⚠ SCOPED TO THE LEAGUE'S OWN PLAYERS, not the ~whole NFL map, so an import pays for one small
 * registry read rather than walking thousands of ids on every refresh.
 *
 * ⚠ THE UPDATE IS ADDITIVE AND RE-CHECKED IN SQL, exactly like `ingestProFantraxIdentities`: it only
 * fills a NULL `fantraxId`, only on an NFL row, and never when another NFL row already carries that
 * id — so a plan computed from a read that went stale mid-import cannot overwrite anything.
 *
 * Never throws: an identity link is an improvement to an import, not a condition of it.
 */
export async function linkNflFantraxIdentities(refs: FantraxPlayerRef[]) {
  const usable = refs.filter((r) => r && String(r.fantraxId ?? '').trim())
  if (usable.length === 0) return { proposed: 0, updated: 0 }
  try {
    const fantraxIds = [...new Set(usable.map((r) => String(r.fantraxId).trim()))]
    const nameKeys = [...new Set(usable.map((r) => fantraxNflNameKey(r.name)).filter(Boolean))]
    const rows = await prisma.playerIdentityMap.findMany({
      where: { sport: 'NFL', OR: [{ fantraxId: { in: fantraxIds } }, { normalizedName: { in: nameKeys } }] },
      select: { id: true, canonicalName: true, currentTeam: true, position: true, fantraxId: true },
    })
    const { links, ...coverage } = planNflFantraxIdentityLinks(usable, rows)
    if (links.length === 0) return { ...coverage, proposed: 0, updated: 0 }
    const updated = await prisma.$executeRaw`
      WITH links AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(links)}::jsonb) AS l(id text, "fantraxId" text))
      UPDATE "PlayerIdentityMap" p SET "fantraxId"=l."fantraxId", "updatedAt"=NOW(), "lastSyncedAt"=NOW()
      FROM links l WHERE p.id=l.id AND p.sport='NFL' AND p."fantraxId" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "PlayerIdentityMap" other WHERE other.sport='NFL' AND other."fantraxId"=l."fantraxId")
    `
    return { ...coverage, proposed: links.length, updated }
  } catch (error) {
    console.warn('[fantrax] NFL identity link skipped:', error instanceof Error ? error.message : 'unknown error')
    return { proposed: 0, updated: 0, error: true as const }
  }
}
