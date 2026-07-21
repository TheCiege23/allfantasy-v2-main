/**
 * Admin role preview — "view this league as a Manager / Co-Commissioner /
 * Commissioner".
 *
 * This module is PURE and isomorphic on purpose. It holds the authorization
 * rule and nothing else; the server-side admin lookup lives in
 * `adminPreviewServer.ts`. Same split as `lib/access/canAccess.ts` (pure) vs
 * `canAccessForUser.ts` (`server-only`), and for the same reason: a security
 * rule that cannot be exercised without a request context tends to go untested.
 *
 * The design prototype gates this on `/[?&]admin=/` in the URL, i.e. anyone who
 * types `?admin=1`. That is a prototype affordance, not an authorization model,
 * and is deliberately NOT reproduced. Two rules replace it:
 *
 * **1. Admin status is proven server-side.** `getAdminAccessState()`
 * (`lib/adminAuth.ts`) is the same gate every `/api/admin/*` route already uses
 * in production — reused rather than re-implemented, for the same reason
 * `platformOsAuthorization` reuses it. A query parameter can request a preview;
 * it can never confer one.
 *
 * **2. The preview may only DOWNGRADE, never elevate.** This is the load-bearing
 * rule. If a preview could raise the effective role, `?viewAs=commissioner`
 * would become a way for a site admin to read commissioner-only operations data
 * — attention queues, retention-risk managers, league-wide activity — for a
 * league where they are merely a member. That is privilege escalation wearing a
 * debug-tool costume. So the effective role is always
 * `min(realRole, requestedRole)` on the authority ladder, and an attempt to
 * elevate is reported back (`deniedElevation`) rather than silently ignored, so
 * the UI can say why nothing changed.
 *
 * Net effect: an admin who is genuinely a commissioner of this league can check
 * what a plain manager sees. An admin who is not a commissioner here cannot
 * manufacture commissioner access. Site-wide admin tooling continues to live
 * behind `/admin`, where it is separately gated.
 */
import type { CommandCenterRole } from './types'

/** Authority ladder. Higher index = more authority. */
const ROLE_LADDER: readonly CommandCenterRole[] = ['manager', 'co_commissioner', 'commissioner']

function rank(role: CommandCenterRole): number {
  const index = ROLE_LADDER.indexOf(role)
  return index === -1 ? 0 : index
}

export function isCommandCenterRole(value: string): value is CommandCenterRole {
  return (ROLE_LADDER as readonly string[]).includes(value)
}

export interface AdminRolePreview {
  /** True only when the viewer is a server-verified site admin. Drives whether the control renders at all. */
  isAdmin: boolean
  /** The viewer's genuine role in this league. */
  realRole: CommandCenterRole
  /** The role the page should actually render as. Never above `realRole`. */
  effectiveRole: CommandCenterRole
  /** True when a preview is actively narrowing the view. */
  previewActive: boolean
  /** Set when a preview was requested that would have elevated authority — refused. */
  deniedElevation: CommandCenterRole | null
}

/**
 * The security rule, as a pure function.
 *
 * Deliberately separated from the admin lookup so the downgrade-only invariant
 * can be exercised directly in tests without a request context — an
 * authorization rule that is awkward to test tends to go untested.
 *
 * `isAdmin` must be a PROVEN value from `getAdminAccessState()`. This function
 * trusts it; it does not establish it.
 */
export function applyRolePreview(args: {
  isAdmin: boolean
  realRole: CommandCenterRole
  requestedRole: string | null
}): AdminRolePreview {
  const base: AdminRolePreview = {
    isAdmin: args.isAdmin,
    realRole: args.realRole,
    effectiveRole: args.realRole,
    previewActive: false,
    deniedElevation: null,
  }

  // A non-admin's parameter is inert — it never reaches the role calculation.
  if (!args.isAdmin) return { ...base, isAdmin: false }

  const requested = args.requestedRole?.trim()
  if (!requested || !isCommandCenterRole(requested)) return base
  if (requested === args.realRole) return base

  // Downgrade-only. An elevation request is refused and reported, never applied.
  if (rank(requested) > rank(args.realRole)) {
    return { ...base, deniedElevation: requested }
  }

  return { ...base, effectiveRole: requested, previewActive: true }
}

/** Roles an admin may preview, given their real role. Never includes anything above it. */
export function availablePreviewRoles(realRole: CommandCenterRole): CommandCenterRole[] {
  return ROLE_LADDER.filter((role) => rank(role) <= rank(realRole))
}
