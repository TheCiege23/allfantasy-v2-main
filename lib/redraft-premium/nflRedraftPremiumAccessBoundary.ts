import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { EntitlementResolver, type EntitlementSnapshot } from '@/lib/subscription/EntitlementResolver'
import { assertLeagueMemberWithCode } from '@/lib/league/league-access'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import type {
  NflRedraftPremiumServiceId,
  NflRedraftPremiumServiceVariant,
} from '@/lib/redraft-premium/nflRedraftPremiumServices'

type SessionResult = { user?: { id?: string | null; email?: string | null } | null } | null

export type NflRedraftPremiumAccessDeniedCode =
  | 'unauthenticated'
  | 'league_membership_denied'
  | 'league_not_found'
  | 'commissioner_required'
  | 'auth_boundary_unavailable'

export type NflRedraftPremiumAccessBoundaryResult =
  | {
      ok: true
      userId: string
      userEmail: string | null
      isLeagueMember: true
      isCommissioner: boolean
      entitlement: EntitlementSnapshot
    }
  | {
      ok: false
      status: 401 | 403 | 404 | 500
      code: NflRedraftPremiumAccessDeniedCode
      message: string
      fields: string[]
    }

export type NflRedraftPremiumAccessBoundaryInput = {
  leagueId: string
  serviceId: NflRedraftPremiumServiceId
  serviceVariant?: NflRedraftPremiumServiceVariant
}

export type NflRedraftPremiumAccessBoundaryDeps = {
  getSession?: () => Promise<SessionResult>
  assertLeagueMember?: typeof assertLeagueMemberWithCode
  isCommissioner?: typeof isElevatedCommissioner
  resolveEntitlement?: (userId: string, email?: string | null) => Promise<EntitlementSnapshot>
}

export function requiresCommissionerForNflRedraftPremiumService(input: {
  serviceId: NflRedraftPremiumServiceId
  serviceVariant?: NflRedraftPremiumServiceVariant
}): boolean {
  return input.serviceId === 'commissioner_digest' || (input.serviceId === 'trade_review' && input.serviceVariant === 'commissioner')
}

export function stripClientEntitlementForServerResolution<T extends Record<string, unknown>>(
  requestBody: T,
  entitlement: EntitlementSnapshot,
): T & { entitlement: { status: EntitlementSnapshot['status']; plans: EntitlementSnapshot['plans'] } } {
  const rest = { ...requestBody }
  delete rest.requestedTier
  delete rest.entitlement
  return {
    ...rest,
    entitlement: {
      status: entitlement.status,
      plans: entitlement.plans,
    },
  } as T & { entitlement: { status: EntitlementSnapshot['status']; plans: EntitlementSnapshot['plans'] } }
}

export async function enforceNflRedraftPremiumAccess(
  input: NflRedraftPremiumAccessBoundaryInput,
  deps: NflRedraftPremiumAccessBoundaryDeps = {},
): Promise<NflRedraftPremiumAccessBoundaryResult> {
  try {
    const getSession = deps.getSession ?? (() => getServerSession(authOptions as never) as Promise<SessionResult>)
    const session = await getSession()
    const userId = session?.user?.id?.trim() ?? ''
    const userEmail = session?.user?.email ?? null
    if (!userId) {
      return {
        ok: false,
        status: 401,
        code: 'unauthenticated',
        message: 'Authentication is required for NFL redraft premium services.',
        fields: ['session'],
      }
    }

    const memberCheck = await (deps.assertLeagueMember ?? assertLeagueMemberWithCode)(input.leagueId, userId)
    if (!memberCheck.ok) {
      return {
        ok: false,
        status: memberCheck.httpStatus === 404 ? 404 : 403,
        code: memberCheck.code === 'LEAGUE_NOT_FOUND' ? 'league_not_found' : 'league_membership_denied',
        message:
          memberCheck.code === 'LEAGUE_NOT_FOUND'
            ? 'League was not found.'
            : 'League membership is required for NFL redraft premium services.',
        fields: ['leagueId'],
      }
    }

    const isCommissioner = await (deps.isCommissioner ?? isElevatedCommissioner)(input.leagueId, userId)
    if (requiresCommissionerForNflRedraftPremiumService(input) && !isCommissioner) {
      return {
        ok: false,
        status: 403,
        code: 'commissioner_required',
        message: 'Commissioner access is required for this NFL redraft premium service.',
        fields: ['serviceType'],
      }
    }

    const entitlement =
      deps.resolveEntitlement != null
        ? await deps.resolveEntitlement(userId, userEmail)
        : await new EntitlementResolver().resolveSnapshot(userId, userEmail)

    return {
      ok: true,
      userId,
      userEmail,
      isLeagueMember: true,
      isCommissioner,
      entitlement,
    }
  } catch {
    return {
      ok: false,
      status: 500,
      code: 'auth_boundary_unavailable',
      message: 'Premium service access could not be verified.',
      fields: ['access'],
    }
  }
}
