/**
 * Which key a manager's draft queue or waiver watchlist is stored under, for the team they are on.
 * See `teamScopedKey` in lib/league/rosterManager.ts. A manager with one team gets their user id back
 * with a single read, so nothing changes for them.
 */
import { prisma } from '@/lib/prisma'
import { getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { isRosterManagedBy, teamScopedKey } from '@/lib/league/rosterManager'
import { listHeldTeams, resolveViewingRoster } from '@/lib/league/viewerTeams'

async function keyForRoster(leagueId: string, userId: string, rosterId: string | null | undefined): Promise<string> {
  if (!rosterId) return userId
  const roster = await prisma.roster.findFirst({ where: { id: rosterId, leagueId }, select: { id: true, platformUserId: true, managerUserId: true } })
  // Only a team this manager runs changes the key; a co-owned or commissioner-viewed team does not.
  if (!roster || !isRosterManagedBy(roster, userId)) return userId
  return teamScopedKey(roster) ?? userId
}

/** The draft queue key: the team the draft room is about for this manager (named, on the clock, or switched to). */
export async function draftQueueKeyForUser(leagueId: string, userId: string, requestedRosterId?: string | null): Promise<string> {
  // Working out the key must never cost a manager their queue: any failure reads their own.
  try {
    const held = await listHeldTeams(leagueId, userId)
    if (held.length <= 1) return userId
    return await keyForRoster(leagueId, userId, await getCurrentUserRosterIdForLeague(leagueId, userId, requestedRosterId))
  } catch {
    return userId
  }
}

/** The waiver watchlist key: the team named, else the team the manager switched to, else their first. */
export async function watchlistKeyForUser(leagueId: string, userId: string, requestedRosterId?: string | null): Promise<string> {
  try {
    const viewing = await resolveViewingRoster(leagueId, userId, requestedRosterId, { allowCoOwner: false })
    if (!viewing || viewing.heldCount <= 1) return userId
    return await keyForRoster(leagueId, userId, viewing.rosterId)
  } catch {
    return userId
  }
}

/** The key the draft engine reads for the team on the clock: that team's own queue. */
export async function draftQueueKeyForRoster(rosterId: string): Promise<string | null> {
  try {
    const roster = await prisma.roster.findUnique({ where: { id: rosterId }, select: { id: true, platformUserId: true, managerUserId: true } })
    return roster ? teamScopedKey(roster) : null
  } catch {
    return null
  }
}

/** The draft queue key when only the draft session is known. */
export async function draftQueueKeyForSession(sessionId: string, userId: string): Promise<string> {
  try {
    const session = await prisma.draftSession.findUnique({ where: { id: sessionId }, select: { leagueId: true } })
    return session?.leagueId ? await draftQueueKeyForUser(session.leagueId, userId) : userId
  } catch {
    return userId
  }
}
