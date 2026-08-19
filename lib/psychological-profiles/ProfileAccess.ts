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
 * Sold on Pro and War Room, with Supreme inheriting both. War Room is not a
 * superset of Pro, so this feature is the reason the access check now accepts ANY
 * of a feature's plans rather than only the first one listed — see
 * getAcceptedPlansForFeature.
 */
const OPPONENT_FEATURE: SubscriptionFeatureId = 'manager_psychology'

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

/**
 * Manager psychology as grounding lines for an LLM.
 *
 * An LLM given a partial picture fills the rest in, confidently and in the same
 * voice as the parts it was told. So this states the ABSENCE as explicitly as the
 * presence: a manager we have not observed enough is listed as unobserved with a
 * standing instruction not to characterise them, rather than being left out of
 * the list where the model would infer whatever the conversation suggests.
 *
 * Returns an empty array when the viewer is not entitled, so the gate holds here
 * exactly as it does on the API surfaces.
 */
export async function buildPsychologyGroundingLines(input: {
  leagueId: string
  userId: string | undefined | null
  email?: string | null
  limit?: number
}): Promise<string[]> {
  const access = await resolveProfileAccessForUser(input.leagueId, input.userId, input.email)
  if (!access.ok) return []

  const { listProfilesByLeague } = await import('./ManagerBehaviorQueryService')
  const profiles = await listProfilesByLeague(input.leagueId, { limit: input.limit ?? 16 }).catch(
    () => []
  )
  if (profiles.length === 0) return []

  const lines: string[] = []
  const unobserved: string[] = []

  for (const profile of profiles) {
    const isSelf = access.ownManagerIds.has(profile.managerId)
    if (!isSelf && !access.canSeeOpponents) continue

    const labels = Array.isArray(profile.profileLabels) ? profile.profileLabels : []
    const summary = profile.evidenceSummary
    if (labels.length === 0 || !summary?.anySufficient) {
      unobserved.push(profile.managerId)
      continue
    }
    const observed = summary.observedDimensions
      .map((d) => `${d}:${summary.dimensions[d].evidenceCount}`)
      .join(', ')
    lines.push(
      `manager ${profile.managerId}${isSelf ? ' (this user)' : ''}: ${labels.join(', ')} — observed from ${observed}`
    )
  }

  if (lines.length === 0 && unobserved.length === 0) return []

  const out = ['MANAGER PSYCHOLOGY (observed behaviour in this league only):']
  out.push(...lines)
  if (unobserved.length > 0) {
    out.push(
      `NOT OBSERVED — say nothing about how these managers behave, and do not infer it from context: ${unobserved.join(', ')}`
    )
  }
  out.push(
    'These describe past behaviour only. Do not use them to change a projection, grade or recommendation; cite them as context and say so.'
  )
  return out
}
