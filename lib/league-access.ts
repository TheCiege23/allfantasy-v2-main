import { prisma } from '@/lib/prisma'

/** Which populated column proved membership. Useful in tests and logs. */
export type LeagueMembershipVia = 'owner' | 'redraft' | 'roster' | 'claim'

export interface LeagueAccessResult {
  leagueId: string
  leagueSport: string
  isCommissioner: boolean
  isMember: boolean
  isOwner: boolean
  via: LeagueMembershipVia
}

/**
 * Distinguishes "league does not exist" from "you are not in it", which
 * `resolveLeagueAccess` cannot express (it returns null for both). Callers that
 * need the 401 -> 404 -> 403 ordering should use this.
 */
export type LeagueMembership =
  | { ok: true; access: LeagueAccessResult }
  | { ok: false; reason: 'anonymous'; status: 401 }
  | { ok: false; reason: 'not_found'; status: 404 }
  | { ok: false; reason: 'not_member'; status: 403 }

/**
 * THE canonical league-membership predicate. Keys on the uuid `League.id` space,
 * never the Sleeper numeric id.
 *
 * Membership is proved by any of four ALWAYS-POPULATED columns:
 *
 *   League.userId                  owner / commissioner
 *   RedraftLeagueMember.userId     redraft leagues
 *   Roster.platformUserId          String, NOT NULL, @@unique([leagueId, platformUserId])
 *   LeagueTeam.claimedByUserId     claim-only managers
 *
 * `LeagueTeam.platformUserId` is deliberately NOT part of the gate. It is
 * `String?`, but the sharper reason is coverage: league_teams rows describe a
 * different population than rosters. Measured against production 2026-07-20,
 * gating on it rejected 98 of 176 real Roster-backed members (55.7%). Adding it
 * here would re-introduce that false-negative class. Read it for display, never
 * for access.
 *
 * Ordered cheapest-first: the owner check needs no extra query, and each
 * subsequent lookup is skipped once membership is proved.
 */
export async function resolveLeagueMembership(
  leagueId: string,
  userId: string | undefined | null
): Promise<LeagueMembership> {
  if (!userId) return { ok: false, reason: 'anonymous', status: 401 }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, sport: true, userId: true },
  })
  if (!league) return { ok: false, reason: 'not_found', status: 404 }

  const base = { leagueId: league.id, leagueSport: league.sport }

  if (league.userId === userId) {
    return {
      ok: true,
      access: { ...base, isCommissioner: true, isMember: true, isOwner: true, via: 'owner' },
    }
  }

  const redraftMember = await prisma.redraftLeagueMember.findUnique({
    where: { leagueId_userId: { leagueId, userId } },
    select: { role: true },
  })
  if (redraftMember) {
    return {
      ok: true,
      access: {
        ...base,
        isCommissioner: redraftMember.role === 'COMMISSIONER',
        isMember: true,
        isOwner: false,
        via: 'redraft',
      },
    }
  }

  const rosterCount = await prisma.roster.count({
    where: { leagueId, platformUserId: userId },
  })
  if (rosterCount > 0) {
    return {
      ok: true,
      access: { ...base, isCommissioner: false, isMember: true, isOwner: false, via: 'roster' },
    }
  }

  const claimedCount = await prisma.leagueTeam.count({
    where: { leagueId, claimedByUserId: userId },
  })
  if (claimedCount > 0) {
    return {
      ok: true,
      access: { ...base, isCommissioner: false, isMember: true, isOwner: false, via: 'claim' },
    }
  }

  return { ok: false, reason: 'not_member', status: 403 }
}

/**
 * Back-compatible shape for existing callers: null means "no access", collapsing
 * anonymous / not-found / not-member. Prefer `resolveLeagueMembership` in new code.
 */
export async function resolveLeagueAccess(
  leagueId: string,
  userId: string | undefined | null
): Promise<LeagueAccessResult | null> {
  const result = await resolveLeagueMembership(leagueId, userId)
  return result.ok ? result.access : null
}

export async function assertLeagueMember(
  leagueId: string,
  userId: string | undefined | null
): Promise<LeagueAccessResult> {
  const result = await resolveLeagueMembership(leagueId, userId)
  if (!result.ok) {
    // Deliberately always 403, matching the previous implementation exactly.
    // It collapsed anonymous / not-found / not-member into one 403, and ~28
    // callers depend on that status; widening it to 404 here would silently
    // change their responses and leak league existence. Routes that need the
    // 401 -> 404 -> 403 ordering call resolveLeagueMembership directly.
    const err = new Error('Forbidden') as Error & { status?: number }
    err.status = 403
    throw err
  }
  return result.access
}
