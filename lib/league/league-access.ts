import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
import { prisma } from '@/lib/prisma'

import { getLeagueRole } from '@/lib/league/permissions'
import { isTournamentCoCommissioner } from '@/lib/league/tournamentCoCommissioners'
import type { LeagueToolAccessErrorCode } from '@/lib/ai-tools/league-tool-context-types'

export async function assertLeagueMember(leagueId: string, userId: string) {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    include: { teams: { where: { claimedByUserId: userId } } },
  })
  if (!league) return { ok: false as const, status: 404 as const }
  if (league.userId === userId) return { ok: true as const, league }
  if (league.teams.length > 0 || await acceptedCoOwnerRosterId(leagueId, userId)) return { ok: true as const, league }
  // A tournament co-commissioner runs the league without holding a team in it.
  if (isTournamentCoCommissioner(league.settings, userId)) return { ok: true as const, league }
  return { ok: false as const, status: 403 as const }
}

/**
 * Same membership rules as assertLeagueMember, with explicit codes for APIs and AI tools.
 */
export async function assertLeagueMemberWithCode(
  leagueId: string,
  userId: string,
): Promise<
  | { ok: true; league: NonNullable<Awaited<ReturnType<typeof prisma.league.findFirst>>> }
  | { ok: false; code: LeagueToolAccessErrorCode; httpStatus: 400 | 403 | 404 }
> {
  const trimmed = leagueId?.trim()
  if (!trimmed) {
    return { ok: false, code: 'INVALID_LEAGUE_ID', httpStatus: 400 }
  }

  const league = await prisma.league.findFirst({
    where: { id: trimmed },
    include: { teams: { where: { claimedByUserId: userId } } },
  })
  if (!league) {
    return { ok: false, code: 'LEAGUE_NOT_FOUND', httpStatus: 404 }
  }
  if (league.userId === userId) {
    return { ok: true, league }
  }
  if (league.teams.length > 0 || isTournamentCoCommissioner(league.settings, userId) || await acceptedCoOwnerRosterId(trimmed, userId)) {
    return { ok: true, league }
  }
  return { ok: false, code: 'NOT_LEAGUE_MEMBER', httpStatus: 403 }
}

/** Head commissioner or co-commissioner (settings access). */
export async function assertLeagueCommissioner(leagueId: string, userId: string) {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    include: { teams: true },
  })
  if (!league) return { ok: false as const, status: 404 as const }
  const role = await getLeagueRole(leagueId, userId)
  if (role === 'commissioner' || role === 'co_commissioner') {
    return { ok: true as const, league }
  }
  return { ok: false as const, status: 403 as const }
}
