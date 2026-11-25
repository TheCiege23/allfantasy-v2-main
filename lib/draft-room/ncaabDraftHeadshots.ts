import { prisma } from '@/lib/prisma'
import { currentNcaabSeasonYear, isEspnNcaabHeadshot, readEspnNcaabHeadshots } from '@/lib/espn/ncaabRosterSnapshot'

/**
 * College basketball headshots for the draft pool: ESPN's, attached by id, or none.
 *
 * 🛑 THE POOL'S GENERAL PHOTO LADDER PUTS STRANGERS' FACES ON COLLEGE PLAYERS. Its second rung is
 * "same name and position, any team" — and college basketball has three positions and 22,000 player
 * rows across seasons, so "Jalen Johnson, G" is several people. Measured on production 2026-11-25:
 * a 1,431-player pool showed 847 photos while only the ESPN roster sweep attaches photos to a
 * specific player (school + name + jersey, `lib/espn/ncaabEspnMatch.ts`); 67 vendor rows carried a
 * TheSportsDB picture matched by name alone, among them a 2019 cutout on a current guard.
 *
 * So for NCAAB a photo must be tied to the player:
 *   1. ESPN's headshot for the ESPN athlete id this player's identity is linked to;
 *   2. an ESPN headshot the sweep wrote onto this player's own row;
 *   3. an ESPN headshot on a row with the same name, position AND school (the vendor's second row
 *      for one player).
 * Anything else is no photo, and the board shows initials. A missing photo is honest.
 */
export function resolveNcaabDraftHeadshot(candidates: {
  /** By linked ESPN athlete id. */
  byEspnId?: string | null
  /** The pool row's own image, then its matched pool record's. */
  own?: Array<string | null | undefined>
  /** Same name + position + school. */
  sameSchool?: string | null
}): string | null {
  if (isEspnNcaabHeadshot(candidates.byEspnId)) return candidates.byEspnId
  for (const url of candidates.own ?? []) if (isEspnNcaabHeadshot(url)) return url
  return isEspnNcaabHeadshot(candidates.sameSchool) ? candidates.sameSchool : null
}

/**
 * Rolling Insights player id → ESPN headshot, through `PlayerIdentityMap.espnId` and the fresh ESPN
 * roster snapshots. A Rolling Insights id claimed by two identities is dropped: picking one would
 * hand a player someone else's face.
 */
export async function loadNcaabEspnHeadshotsByRiId(rollingInsightsIds: readonly string[], now: Date = new Date()): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const riIds = [...new Set(rollingInsightsIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
  if (riIds.length === 0) return out
  const [identities, photos] = await Promise.all([
    prisma.playerIdentityMap.findMany({
      where: { sport: 'NCAAB', rollingInsightsId: { in: riIds }, espnId: { not: null } },
      select: { rollingInsightsId: true, espnId: true },
    }),
    readEspnNcaabHeadshots(prisma, currentNcaabSeasonYear(now), now),
  ])
  if (photos.size === 0) return out
  const espnByRi = new Map<string, string | null>()
  for (const identity of identities) {
    const ri = String(identity.rollingInsightsId ?? '').trim()
    const espn = String(identity.espnId ?? '').trim()
    if (!ri || !espn) continue
    espnByRi.set(ri, espnByRi.has(ri) && espnByRi.get(ri) !== espn ? null : espn)
  }
  for (const [ri, espn] of espnByRi) {
    const url = espn ? photos.get(espn) : undefined
    if (url) out.set(ri, url)
  }
  return out
}
