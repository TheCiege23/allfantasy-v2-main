/**
 * Draft access: league owner or commissioner can access; members can view/submit when on clock.
 */

import { listHeldTeams } from '@/lib/league/viewerTeams'
import { prisma } from '@/lib/prisma'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { acceptedCoOwnerRosterId, isAcceptedCoOwnerForRoster } from '@/lib/team-coowners/access'

function getDevBypassUserId(): string | null {
  if (process.env.NODE_ENV === 'production') return null
  if (process.env.DEV_AUTH_BYPASS_ENABLED?.trim() !== 'true') return null
  return process.env.DEV_AUTH_BYPASS_USER_ID?.trim() || 'local-dev-user'
}

function isDevBypassUser(userId: string | undefined): boolean {
  const devUserId = getDevBypassUserId()
  return Boolean(userId && devUserId && userId === devUserId)
}

async function getDevBypassFallbackRosterId(
  leagueId: string,
  userId: string | undefined
): Promise<string | null> {
  if (!isDevBypassUser(userId)) return null

  const roster = await prisma.roster.findFirst({
    where: {
      leagueId,
      platformUserId: {
        startsWith: 'orphan-',
      },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })

  return roster?.id ?? null
}

/**
 * User can view draft session if they are commissioner (league owner), have their own roster
 * in the league (rosters table), or are a claimed/platform member via league_teams.
 *
 * league_teams.platformUserId  — platform-synced user id (Sleeper, etc.)
 * league_teams.claimedByUserId — AllFantasy user who claimed this team slot
 * Both map to session.user.id (AppUser.id). Checking both ensures access regardless
 * of whether the user imported or claimed their team first.
 */
export async function canAccessLeagueDraft(leagueId: string, userId: string | undefined): Promise<boolean> {
  if (!userId) return false
  if (await isCommissioner(leagueId, userId)) return true
  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { id: true },
  })
  if (roster) return true
  const team = await prisma.leagueTeam.findFirst({
    where: {
      leagueId,
      OR: [{ platformUserId: userId }, { claimedByUserId: userId }],
    },
    select: { id: true },
  })
  if (team) return true
  if (await acceptedCoOwnerRosterId(leagueId, userId)) return true
  return (await getDevBypassFallbackRosterId(leagueId, userId)) != null
}

/**
 * User can submit a pick if they are commissioner or the rosterId is theirs (on clock).
 */
export async function canSubmitPickForRoster(
  leagueId: string,
  userId: string | undefined,
  rosterId: string
): Promise<boolean> {
  if (!userId) return false
  if (await isCommissioner(leagueId, userId)) return true
  const roster = await prisma.roster.findFirst({
    where: { id: rosterId, leagueId },
    select: { id: true, platformUserId: true },
  })
  if (!roster) return false
  if (roster.platformUserId === userId) return true
  if (await isAcceptedCoOwnerForRoster(leagueId, rosterId, userId)) return true

  const devFallbackRosterId = await getDevBypassFallbackRosterId(leagueId, userId)
  if (devFallbackRosterId && devFallbackRosterId === rosterId) return true

  return false
}

/**
 * Every roster this user may act for in the league's draft: each team they hold, or, holding none, the
 * team they co-own (then the dev-bypass fallback). A manager who runs several teams is on the clock
 * whenever ANY of these is, so "is it my turn" must be asked of the whole list.
 */
export async function getCurrentUserRosterIdsForLeague(
  leagueId: string,
  userId: string | undefined
): Promise<string[]> {
  if (!userId) return []
  const held = await listHeldTeams(leagueId, userId)
  if (held.length > 0) return held.map((team) => team.rosterId)
  const coOwnedRosterId = await acceptedCoOwnerRosterId(leagueId, userId)
  if (coOwnedRosterId) return [coOwnedRosterId]
  const devFallbackRosterId = await getDevBypassFallbackRosterId(leagueId, userId)
  return devFallbackRosterId ? [devFallbackRosterId] : []
}

/**
 * Current user's roster id for this league (for draft room: "am I on the clock?" and auto-pick).
 * Returns null if the user has no roster in the league.
 *
 * With several teams this is the one named by `requestedRosterId` when the user holds it, otherwise
 * their first (a stable order). A caller deciding whose turn it is should use
 * `getCurrentUserRosterIdsForLeague` instead, so the user's other teams are not missed.
 */
export async function getCurrentUserRosterIdForLeague(
  leagueId: string,
  userId: string | undefined,
  requestedRosterId?: string | null
): Promise<string | null> {
  const rosterIds = await getCurrentUserRosterIdsForLeague(leagueId, userId)
  const requested = typeof requestedRosterId === 'string' ? requestedRosterId.trim() : ''
  if (requested && rosterIds.includes(requested)) return requested
  return rosterIds[0] ?? null
}

/**
 * Dispersal draft: only the roster owner may submit picks (no commissioner proxy).
 * Caller must also enforce turn order and `passedRosterIds` in the engine.
 */
export async function canSubmitDispersalPickForUser(
  leagueId: string,
  userId: string | undefined,
  rosterId: string
): Promise<boolean> {
  if (!userId) return false
  const roster = await prisma.roster.findFirst({
    where: { id: rosterId, leagueId },
    select: { id: true, platformUserId: true },
  })
  if (!roster) return false
  return roster.platformUserId === userId || await isAcceptedCoOwnerForRoster(leagueId, rosterId, userId)
}
