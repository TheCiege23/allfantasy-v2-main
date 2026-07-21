import 'server-only'

/**
 * Server half of the admin role preview: establishes whether the caller is a
 * genuine site admin, then hands off to the pure rule in `adminPreview.ts`.
 *
 * Mirrors the `canAccess` / `canAccessForUser` split — the decision is pure and
 * testable, the I/O is isolated here.
 *
 * `getAdminAccessState` (`lib/adminAuth.ts`) is the same gate every
 * `/api/admin/*` route already uses in production. Reused rather than
 * reimplemented, for the same reason `platformOsAuthorization` reuses it: this
 * is not a new authorization system, and a second one would be a second thing
 * to get wrong.
 */
import { getAdminAccessState } from '@/lib/adminAuth'
import { applyRolePreview, type AdminRolePreview } from './adminPreview'
import type { CommandCenterRole } from './types'

export async function resolveAdminRolePreview(args: {
  realRole: CommandCenterRole
  /** Raw `?viewAs=` value, unvalidated. */
  requestedRole: string | null
}): Promise<AdminRolePreview> {
  let isAdmin = false
  try {
    const state = await getAdminAccessState()
    isAdmin = state.status === 'admin'
  } catch (error) {
    // Fail closed: an unresolvable admin check is treated as "not an admin".
    console.error('[command-center] admin access check failed', error)
    isAdmin = false
  }

  return applyRolePreview({
    isAdmin,
    realRole: args.realRole,
    requestedRole: args.requestedRole,
  })
}
