/**
 * Before a RE-SYNC writes a league row: whose row should it be?
 *
 * 🛑 A RE-SYNC MUST NEVER HAND A MEMBER THEIR OWN COPY OF A LEAGUE SOMEONE ELSE IMPORTED.
 *
 * League rows are keyed `(userId, platform, platformLeagueId, season)`, and both re-sync paths
 * (`/api/leagues/import/resync` and the legacy `/api/league/sync`) persist as the CALLER. A caller
 * with no row of their own therefore CREATED one, owned by them, and every owner-based check reads
 * an owner as the commissioner. The import itself already refuses this (a member joins the existing
 * league with `claimExistingLeagueForMember`); re-sync was the way around it.
 *
 *   own      the caller has a row, or nobody has imported this league yet → write the caller's row
 *   member   someone else's row exists and the caller holds a team in it → refresh THAT row
 *   outsider someone else's row exists and the caller holds no team in it → write nothing
 *
 * A system-owned row (a public ESPN league people joined by picking a team) is preferred when the
 * caller holds teams in more than one. A read that fails answers `own`, which is the behaviour from
 * before this existed rather than a refusal of the caller's own league.
 */
import { prisma } from '@/lib/prisma'
import { isSystemLeagueOwner } from '@/lib/league-import/systemLeagueOwner'

type LeagueCopyTarget =
  | { kind: 'own' }
  | { kind: 'member'; ownerUserId: string; leagueId: string }
  | { kind: 'outsider' }

export async function resolveLeagueCopyTarget(input: {
  userId: string
  platform: string
  platformLeagueId: string
  /** Omit to consider every season (the legacy path learns the season only after fetching). */
  season?: number | null
}): Promise<LeagueCopyTarget> {
  try {
    const rows = (await prisma.league.findMany({
      where: {
        platform: input.platform,
        platformLeagueId: String(input.platformLeagueId),
        ...(typeof input.season === 'number' ? { season: input.season } : {}),
      },
      select: { id: true, userId: true },
    })) as Array<{ id: string; userId: string }>
    if (rows.length === 0 || rows.some((r) => r.userId === input.userId)) return { kind: 'own' }

    const held = (await prisma.leagueTeam.findMany({
      where: { leagueId: { in: rows.map((r) => r.id) }, claimedByUserId: input.userId },
      select: { leagueId: true },
    })) as Array<{ leagueId: string }>
    const heldIds = new Set(held.map((t) => t.leagueId))
    const joined = rows.filter((r) => heldIds.has(r.id))
    const target = joined.find((r) => isSystemLeagueOwner(r.userId)) ?? joined[0]
    return target ? { kind: 'member', ownerUserId: target.userId, leagueId: target.id } : { kind: 'outsider' }
  } catch {
    return { kind: 'own' }
  }
}

export const OUTSIDER_RESYNC_ERROR =
  'This league is already on AllFantasy. Import it again to pick your team and join it.'
