/**
 * Draft access: league owner or commissioner can access; members can view/submit when on clock.
 */

import { isRosterManagedBy } from '@/lib/league/rosterManager'
import { listHeldTeams, rememberedActiveTeamIds } from '@/lib/league/viewerTeams'
import { chooseDraftRosterId, resolveOnClockRosterIdForLeague } from './onClockRoster'
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
    select: { id: true, platformUserId: true, managerUserId: true },
  })
  if (!roster) return false
  if (isRosterManagedBy(roster, userId)) return true
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
 * With several teams this is the one named by `requestedRosterId` when the user holds it; otherwise the
 * one on the clock in the league's live draft, so "is it my turn" and "pick for my team" are about the
 * team that is up; otherwise the team they last switched to; otherwise their first.
 */
export async function getCurrentUserRosterIdForLeague(
  leagueId: string,
  userId: string | undefined,
  requestedRosterId?: string | null,
  board?: { status: string; draftType?: string; currentPick?: { rosterId: string } | null },
): Promise<string | null> {
  const rosterIds = await getCurrentUserRosterIdsForLeague(leagueId, userId)
  if (rosterIds.length <= 1) return rosterIds[0] ?? null
  // Several teams: the one named, else the one on the clock (so the room is always about the team that
  // is up), else the team they last switched to, else the first.
  const requested = typeof requestedRosterId === 'string' ? requestedRosterId.trim() : ''
  if (requested && rosterIds.includes(requested)) return requested
  // A board read already resolved traded picks and the on-clock team for every viewer.
  const onClock = board
    ? board.draftType !== 'auction' && (board.status === 'in_progress' || board.status === 'paused')
      ? board.currentPick?.rosterId ?? null
      : null
    : resolveOnClockRosterIdForLeague(leagueId).catch(() => null)
  const [onClockRosterId, rememberedRosterIds] = await Promise.all([
    onClock,
    rememberedActiveTeamIds(),
  ])
  return chooseDraftRosterId({ rosterIds, onClockRosterId, rememberedRosterIds })
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
    select: { id: true, platformUserId: true, managerUserId: true },
  })
  if (!roster) return false
  return isRosterManagedBy(roster, userId) || await isAcceptedCoOwnerForRoster(leagueId, rosterId, userId)
}
