import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'

type Db = Prisma.TransactionClient | typeof prisma

/**
 * 🛑 TWO ENGINES, TWO ANSWERS TO "IS HE ROSTERED". The native add/drop checks availability against
 * `Roster.playerData`. The redraft engine — the hourly `processWaiverWindow` and the waiver runtime's
 * `add_free_agent` — awards into `RedraftRosterPlayer` ONLY and never touches `playerData`. So a player
 * that engine put on team A still looked free to the native add, and team B could take him too: one
 * player, two rosters, no race needed. The league waiver lock serializes the two; it cannot make one see
 * the other's write. This does.
 *
 * Returns the redraft roster that holds `playerId` live in the league's newest season, when it is not
 * the adding team's own. NATIVE leagues only — an imported league's redraft rows are a shadow and must
 * never decide anything. Unreadable: null, logged (the same fail-open as the lock it sits beside).
 */
export async function redraftHolderOtherThan(
  db: Db,
  input: { leagueId: string; genericRosterId: string; playerId: string },
): Promise<string | null> {
  try {
    const league = await db.league.findUnique({ where: { id: input.leagueId }, select: { platform: true } })
    if (!league || resolveWriteAuthority(league.platform) !== 'NATIVE') return null
    const newest = await db.redraftSeason.findFirst({
      where: { leagueId: input.leagueId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (!newest) return null
    const held = await db.redraftRosterPlayer.findFirst({
      where: { playerId: input.playerId, droppedAt: null, roster: { seasonId: newest.id, leagueId: input.leagueId } },
      select: { rosterId: true, roster: { select: { ownerId: true } } },
    })
    if (!held) return null
    const own = await db.roster.findFirst({
      where: { id: input.genericRosterId, leagueId: input.leagueId },
      select: { id: true, redraftRosterId: true, platformUserId: true },
    })
    // The team's own row: by link, or by owner (a dynasty link can still point at last season's roster).
    if (own && (held.rosterId === own.redraftRosterId || ownerMatches(held.roster?.ownerId ?? null, own))) return null
    return held.rosterId
  } catch (err) {
    console.warn('[waiver-wire] redraft roster holder unreadable; add not cross-checked', {
      leagueId: input.leagueId,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

function ownerMatches(ownerId: string | null, roster: { id: string; platformUserId: string | null }): boolean {
  if (!ownerId) return false
  if (ownerId.startsWith('roster:')) return ownerId.slice('roster:'.length) === roster.id
  return roster.platformUserId != null && ownerId === roster.platformUserId
}
