import { commissionerAccess } from '@/lib/league/commissionerAccess'

export interface RosterPermissionResult {
  isCommissioner: boolean
  readOnly: boolean
  reason?: string
}

/**
 * May this user edit the league's roster rules? The head commissioner, or a co-commissioner granted rosters
 * (lib/league/commissionerAccess.ts). This compared `League.userId` alone, so a co-commissioner the head commissioner
 * had given rosters still saw the roster editor read-only and had every save refused (2026-11-16).
 */
export async function checkCommissionerPermission(
  userId: string,
  leagueId: string,
): Promise<RosterPermissionResult> {
  const access = await commissionerAccess(leagueId, userId, 'rosters')
  if (access.ok) return { isCommissioner: true, readOnly: false }
  if (access.status === 404) return { isCommissioner: false, readOnly: true, reason: 'League not found' }
  return { isCommissioner: false, readOnly: true, reason: access.missingScopes ? access.error : 'Commissioner only for editing' }
}

export async function detectReadOnlyRosterView(
  userId: string,
  leagueId: string,
): Promise<boolean> {
  const permission = await checkCommissionerPermission(userId, leagueId)
  return permission.readOnly
}
