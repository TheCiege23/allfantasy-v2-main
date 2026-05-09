/**
 * Draft access: league owner or commissioner can access; members can view/submit when on clock.
 */

import { prisma } from '@/lib/prisma'
import { isCommissioner } from '@/lib/commissioner/permissions'

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

  const devFallbackRosterId = await getDevBypassFallbackRosterId(leagueId, userId)
  if (devFallbackRosterId && devFallbackRosterId === rosterId) return true

  return false
}

/**
 * Current user's roster id for this league (for draft room: "am I on the clock?" and auto-pick).
 * Uses platformUserId = userId; returns null if user has no roster in the league.
 */
export async function getCurrentUserRosterIdForLeague(
  leagueId: string,
  userId: string | undefined
): Promise<string | null> {
  if (!userId) return null
  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { id: true },
  })
  if (roster) return roster.id
  return getDevBypassFallbackRosterId(leagueId, userId)
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
  return roster.platformUserId === userId
}
