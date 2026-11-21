import { prisma } from '@/lib/prisma'
import type { FantraxPlayerRef } from '@/lib/league-import/fantrax/fantraxApi'
import { normalizePlayerName } from '@/lib/team-abbrev'
import { fantraxNflNameKey, looseNflNameKey, planNflFantraxIdentityLinks } from './nflFantraxIdentityPlan'

type LinkRow = { id: string; canonicalName: string; currentTeam: string | null; position: string | null; fantraxId: string | null }

/**
 * NFL registry rows whose stored name equals one of `looseKeys` once punctuation and a trailing
 * "jr" / "iii" are removed. A failed read finds none.
 *
 * ⚠ THE STORED `normalizedName` KEEPS THE SUFFIX on some rows ("marvin mims jr.") while the keys this
 * module builds drop it ("marvin mims"), so the exact-name read never returned them: 45 NFL rows on
 * staging, 2026-11-21. Neither pattern contains a backslash, so no layer between here and Postgres
 * can change it.
 */
async function readRowsByLooseName(looseKeys: string[]): Promise<LinkRow[]> {
  try {
    const found = await prisma.$queryRaw<LinkRow[]>`
      SELECT id, "canonicalName", "currentTeam", position, "fantraxId" FROM "PlayerIdentityMap"
      WHERE sport='NFL' AND regexp_replace(regexp_replace("normalizedName", '[^a-z0-9 ]', '', 'g'), ' (jr|sr|ii|iii|iv|v)$', '')
        = ANY(${looseKeys}::text[])
    `
    return Array.isArray(found) ? found : []
  } catch {
    return []
  }
}

/**
 * Link the Fantrax NFL ids one import received to `PlayerIdentityMap` rows.
 *
 * Called by `importFantraxLeague` for an NFL league, with the refs the import already fetched
 * (`getPlayerIds?sport=NFL`) for the players it rosters or drafted. NO PROVIDER CALL here: the
 * import is the ingestion step, and this is its registry write.
 *
 * ⚠ SCOPED TO THE LEAGUE'S OWN PLAYERS, not the ~whole NFL map, so an import pays for one small
 * registry read (and a second for names that differ only in punctuation) rather than walking
 * thousands of ids on every refresh.
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
    /*
     * A second read, only for the players the read above found no name for: the registry rows whose
     * name matches once punctuation is removed (Fantrax "JaMarr", registry "Ja'Marr" — see
     * `looseNflNameKey`). The pattern has no backslash on purpose, so no layer can change it. This
     * only FINDS candidates; the planner compares names, clubs and positions itself.
     */
    const linkedIds = new Set(rows.map((r) => r.fantraxId?.trim()).filter(Boolean))
    const namesFound = new Set(rows.map((r) => normalizePlayerName(r.canonicalName ?? '')))
    const looseKeys = [...new Set(usable
      .filter((r) => !linkedIds.has(String(r.fantraxId).trim()) && !namesFound.has(fantraxNflNameKey(r.name)))
      .map((r) => looseNflNameKey(fantraxNflNameKey(r.name)))
      .filter(Boolean))]
    const looseRows = looseKeys.length ? await readRowsByLooseName(looseKeys) : []
    const seen = new Set(rows.map((r) => r.id))
    const candidates = [...rows, ...looseRows.filter((r) => !seen.has(r.id))]
    const { links, ...coverage } = planNflFantraxIdentityLinks(usable, candidates)
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
