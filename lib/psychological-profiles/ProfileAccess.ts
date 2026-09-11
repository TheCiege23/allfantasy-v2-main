import 'server-only'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { canAccessForUser } from '@/lib/access/canAccessForUser'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'
import type { ManagerPsychProfileView } from './ManagerBehaviorQueryService'

/** Membership and feature entitlement for internal decision support. Neither grants raw profile access. */
const OPPONENT_FEATURE: SubscriptionFeatureId = 'manager_psychology'

export type ProfileAccessDenied = {
  ok: false
  status: 401 | 403 | 404
  reason: string
}

export type ProfileAccessGranted = {
  ok: true
  userId: string
  /** Manager ids belonging to the caller. Used when scoping decision evidence. */
  ownManagerIds: Set<string>
  canSeeOpponents: boolean
}

export type ProfileAccess = ProfileAccessDenied | ProfileAccessGranted

export async function resolveProfileAccess(leagueId: string): Promise<ProfileAccess> {
  const session = (await getServerSession(authOptions as never)) as
    | { user?: { id?: string; email?: string } }
    | null
  return resolveProfileAccessForUser(leagueId, session?.user?.id, session?.user?.email ?? null)
}

/**
 * Same decision for callers that already hold the user, so a surface which has
 * authenticated once does not resolve the session a second time.
 */
export async function resolveProfileAccessForUser(
  leagueId: string,
  userId: string | undefined | null,
  email?: string | null
): Promise<ProfileAccess> {
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) {
    return { ok: false, status: membership.status, reason: membership.reason }
  }

  // Which manager the caller IS. Profiles are keyed by externalId (the roster id)
  // with a fallback to the row id, so both count as self.
  const ownTeams = await prisma.leagueTeam.findMany({
    where: { leagueId, claimedByUserId: userId },
    select: { id: true, externalId: true },
  })
  const ownManagerIds = new Set<string>(
    ownTeams.flatMap((t) => [t.externalId, t.id]).filter((v): v is string => Boolean(v))
  )

  const decision = await canAccessForUser(OPPONENT_FEATURE, { userId, email: email ?? null })

  return {
    ok: true,
    userId: userId as string,
    ownManagerIds,
    canSeeOpponents: decision.allowed,
  }
}

export type LockedProfile = ReturnType<typeof redactForLock>

/** What a locked profile still reveals: that it exists, and how much was observed. */
export function redactForLock(profile: ManagerPsychProfileView) {
  return {
    id: profile.id,
    leagueId: profile.leagueId,
    managerId: profile.managerId,
    sport: profile.sport,
    sportLabel: profile.sportLabel,
    updatedAt: profile.updatedAt,
    locked: true as const,
    lockedReason: 'Competitive Edge is available within a league decision. Full profiles are private.',
    // Coverage is kept so a locked card can honestly say "8 trades and 44 picks
    // observed" without saying what they reveal. Nothing here characterises the
    // person: no labels, no scores.
    evidenceSummary: profile.evidenceSummary,
    profileLabels: [] as never[],
    displayScores: null,
  }
}

/** Raw profiles never cross a presentation boundary, including self and premium views. */
export function presentProfile(
  profile: ManagerPsychProfileView,
  access: ProfileAccessGranted
): ManagerPsychProfileView | LockedProfile {
  return redactForLock(profile)
}

/** Compatibility boundary: unrestricted profiles must not enter model context. */
export async function buildPsychologyGroundingLines(input: {
  leagueId: string
  userId: string | undefined | null
  email?: string | null
  limit?: number
}): Promise<string[]> {
  // Profile labels and scores must not enter model context where they can be repeated.
  // Decision-scoped evidence is supplied separately after validating the selected action.
  return []
}
