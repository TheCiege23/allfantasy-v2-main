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
import { commissionerAccess, type CommissionerNeed } from '@/lib/league/commissionerAccess'

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
 * The co-commissioner area each commissioner action belongs to (lib/league/commissionerAccess.ts, 2026-11-16).
 *
 * The gate's role tier was "elevated", which passed ANY co-commissioner, so a co-commissioner limited to chat could
 * start the draft, run waivers or process a scoring week. An elevated co-commissioner now also needs the action's
 * area; the head commissioner passes as before. Archiving the league is the head commissioner's alone.
 */
export const LIFECYCLE_ACTION_SCOPE: Record<LeagueLifecycleAction, CommissionerNeed> = {
  draft_pick: 'league',
  draft_commissioner_control: 'league',
  draft_start: 'league',
  waiver_claim_submit: 'league',
  waiver_process_run: 'league',
  scoring_process_week: 'scoring',
  scoring_correction: 'scoring',
  standings_view: 'view',
  standings_manual_edit: 'league',
  settings_edit_general: 'league',
  settings_edit_scoring: 'scoring',
  settings_edit_roster: 'rosters',
  settings_edit_draft: 'league',
  settings_edit_waivers: 'league',
  settings_edit_trades: 'trades',
  settings_edit_playoffs: 'league',
  settings_edit_commissioner: 'league',
  settings_edit_concept_rules: 'league',
  settings_edit_ai: 'league',
  automation_run: 'league',
  roster_edit: 'rosters',
  trade_act: 'trades',
  import_sync: 'league',
  league_archive: 'head',
  league_lock_toggle: 'league',
  renewal_initiate: 'league',
  renewal_confirm: 'league',
  renewal_execute: 'league',
  succession_initiate: 'league',
  legacy_view: 'view',
}

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
    /** Forwarded to `assertLifecycleActionAllowed`: first-come adds in an offseason opened to free agency. */
    offseasonFreeAgency?: boolean
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
  // A commissioner action also needs its area (LIFECYCLE_ACTION_SCOPE). Member actions and a caller that already
  // decided to treat the user as a commissioner (a proxy pick) are unchanged.
  if (!memberScoped && elevated && !opts?.treatAsElevated) {
    const access = await commissionerAccess(leagueId, userId, LIFECYCLE_ACTION_SCOPE[action])
    if (!access.ok) {
      return { ok: false, err: { status: 403, error: access.error, code: 'FORBIDDEN' } }
    }
  }

  return assertLifecycleActionAllowed(leagueId, action, userId, {
    isElevatedCommissioner: elevated || Boolean(opts?.treatAsElevated),
    commissionerOverride: opts?.lifecycle?.commissionerOverride,
    ...(opts?.rosterMove ? { rosterMove: opts.rosterMove } : {}),
    ...(opts?.offseasonFreeAgency ? { offseasonFreeAgency: true } : {}),
  })
}
