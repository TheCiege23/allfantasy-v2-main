/**
 * Unified gate: league membership → role tier → lifecycle + lock / emergency pause.
 * Use in API routes for consistent 401/403/400/423 behavior.
 */

import {
  assertLifecycleActionAllowed,
  type LeagueLifecycleAction,
  type LifecycleGateError,
} from '@/server/services/leagueLifecycleService'
import { canViewLeague, isElevatedCommissioner } from '@/server/services/permissionService'
import type { PostDraftRosterLockStatus, RosterMoveKind } from '@/lib/league/postDraftRosterLock'

/** Actions that normal team managers may perform when lifecycle + roster ownership allow (routes still verify roster/trade specifics). */
export const MEMBER_SCOPED_LIFECYCLE_ACTIONS: ReadonlySet<LeagueLifecycleAction> = new Set([
  'draft_pick',
  'waiver_claim_submit',
  'roster_edit',
  'trade_act',
  'standings_view',
])

export type LeagueActionGateError = LifecycleGateError | { status: 401; error: string; code: 'UNAUTHORIZED' }

/**
 * Enforces:
 * 1. Authenticated user with league access
 * 2. Elevated commissioner for all actions except `MEMBER_SCOPED_LIFECYCLE_ACTIONS`
 * 3. `assertLifecycleActionAllowed` (phase, lock, emergency pause)
 */
export async function assertLeagueActionGate(
  leagueId: string,
  userId: string | undefined | null,
  action: LeagueLifecycleAction,
  opts?: {
    /** Force elevated treatment (e.g. commissioner proxy pick). */
    treatAsElevated?: boolean
    /** Forwarded to `assertLifecycleActionAllowed` (e.g. playoff scoring override). */
    lifecycle?: { commissionerOverride?: boolean }
    /** The roster move, for the post-draft lock (see `assertLifecycleActionAllowed`). */
    rosterMove?: RosterMoveKind
  },
): Promise<{ ok: true; postDraftLock?: PostDraftRosterLockStatus } | { ok: false; err: LeagueActionGateError }> {
  if (!userId) {
    return { ok: false, err: { status: 401, error: 'Unauthorized', code: 'UNAUTHORIZED' } }
  }

  const canView = await canViewLeague(leagueId, userId)
  if (!canView) {
    return { ok: false, err: { status: 403, error: 'Forbidden', code: 'FORBIDDEN' } }
  }

  const elevated = await isElevatedCommissioner(leagueId, userId)
  const memberScoped = MEMBER_SCOPED_LIFECYCLE_ACTIONS.has(action)

  if (!memberScoped && !elevated && !opts?.treatAsElevated) {
    return {
      ok: false,
      err: { status: 403, error: 'Insufficient permissions for this action.', code: 'FORBIDDEN' },
    }
  }

  return assertLifecycleActionAllowed(leagueId, action, userId, {
    isElevatedCommissioner: elevated || Boolean(opts?.treatAsElevated),
    commissionerOverride: opts?.lifecycle?.commissionerOverride,
    ...(opts?.rosterMove ? { rosterMove: opts.rosterMove } : {}),
  })
}
