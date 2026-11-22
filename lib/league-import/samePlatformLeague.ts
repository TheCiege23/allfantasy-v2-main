import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * Every `League.platformLeagueId` that names the SAME provider league as this one.
 *
 * For most providers that is the id itself: Sleeper, ESPN, Yahoo and the rest store the provider's
 * own league id. Fantrax does not. `League.platformLeagueId` for a Fantrax league is the uuid of the
 * `FantraxLeague` snapshot row, and each account (and each "which team is yours?" choice) gets its
 * own row, so two imports of one Fantrax league never shared an id.
 *
 * 🛑 That is why "one copy per league" never applied to Fantrax. Every "is this league already
 * here?" lookup compared `platformLeagueId`, found nothing, and created a whole new copy. Production,
 * 2026-11-22: five Fantrax leagues held 18 copies between them (one 180-team league six times, across
 * three accounts). The provider's real id is `FantraxLeague.sourceLeagueId`; snapshots sharing it,
 * in the same season, are the same league.
 *
 * A snapshot with no `sourceLeagueId` (a CSV-era upload) cannot be matched to anything and answers
 * with its own id alone. Any read failure does the same, so a lookup problem costs a duplicate, never
 * a wrong join.
 */
export async function equivalentPlatformLeagueIds(provider: string, platformLeagueId: string): Promise<string[]> {
  if (provider !== 'fantrax' || !platformLeagueId) return [platformLeagueId]
  try {
    const snapshot = await prisma.fantraxLeague.findUnique({
      where: { id: platformLeagueId },
      select: { sourceLeagueId: true, season: true },
    })
    const sourceLeagueId = snapshot?.sourceLeagueId?.trim()
    if (!snapshot || !sourceLeagueId) return [platformLeagueId]
    const siblings = await prisma.fantraxLeague.findMany({
      where: { sourceLeagueId, season: snapshot.season },
      select: { id: true },
    })
    return [...new Set([platformLeagueId, ...siblings.map((row) => row.id)])]
  } catch {
    return [platformLeagueId]
  }
}

/**
 * The `platformLeagueId` condition for an "is this league already here?" query: the plain id when it
 * is the only one (every provider but Fantrax, and a Fantrax league imported once), an `in` list
 * when the same league is stored under several.
 */
export async function platformLeagueIdWhere(provider: string, platformLeagueId: string): Promise<string | { in: string[] }> {
  const ids = await equivalentPlatformLeagueIds(provider, platformLeagueId)
  return ids.length > 1 ? { in: ids } : platformLeagueId
}
