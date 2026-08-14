import 'server-only'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { canAccessForUser } from '@/lib/access/canAccessForUser'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'
import type { ManagerPsychProfileView } from './ManagerBehaviorQueryService'

/**
 * ProfileAccess — the one place that decides who may read a psychological profile.
 *
 * Psychological profiles are asymmetric by design. Your OWN profile is a mirror:
 * it describes you to you, and it is free. Anyone ELSE's is competitive
 * intelligence about a real person in your league, and that is the premium half.
 *
 * This lives in one module because the surface is five routes wide — list,
 * single, by-id, explain, and the two run endpoints — and a gate that only some
 * of them apply is not a gate. Before this, every one of them was completely
 * unauthenticated: any caller could read a character read on any named manager in
 * any league, or spend compute generating them, just by knowing a league id.
 *
 * Gated on the trade analyzer's entitlement rather than a psychology-specific
 * one. A new SubscriptionFeatureId with no monetization-matrix entry resolves to
 * "locked for everyone", including paying users, and adding that entry means
 * inventing a price point. When psychology is priced on its own, OPPONENT_FEATURE
 * is the only line that changes.
 */
const OPPONENT_FEATURE: SubscriptionFeatureId = 'trade_analyzer'

export type ProfileAccessDenied = {
  ok: false
  status: 401 | 403 | 404
  reason: string
}

export type ProfileAccessGranted = {
  ok: true
  userId: string
  /** Manager ids belonging to the caller. Their own profile is never gated. */
  ownManagerIds: Set<string>
  canSeeOpponents: boolean
}

export type ProfileAccess = ProfileAccessDenied | ProfileAccessGranted

export async function resolveProfileAccess(leagueId: string): Promise<ProfileAccess> {
  const session = (await getServerSession(authOptions as never)) as
    | { user?: { id?: string; email?: string } }
    | null
  const userId = session?.user?.id

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

  const decision = await canAccessForUser(OPPONENT_FEATURE, {
    userId,
    email: session?.user?.email ?? null,
  })

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
    lockedReason: 'Manager psychology for other managers is a premium capability.',
    // Coverage is kept so a locked card can honestly say "8 trades and 44 picks
    // observed" without saying what they reveal. Nothing here characterises the
    // person: no labels, no scores.
    evidenceSummary: profile.evidenceSummary,
    profileLabels: [] as never[],
    displayScores: null,
  }
}

/** Full profile for the caller's own manager or an entitled viewer; locked otherwise. */
export function presentProfile(
  profile: ManagerPsychProfileView,
  access: ProfileAccessGranted
): ManagerPsychProfileView | LockedProfile {
  if (access.ownManagerIds.has(profile.managerId)) return profile
  return access.canSeeOpponents ? profile : redactForLock(profile)
}
