/**
 * Fantasy OS Suite — Phase D Increment 11.
 *
 * The minimum safe authorization model for Platform OS: who is allowed to request
 * `resolvePlatformOsSnapshot` over an arbitrary, caller-supplied list of league IDs?
 *
 * Deliberately reuses the EXISTING, already-real, already-tested internal site-admin gate
 * (`requireAdmin`/`getAdminAccessState`, `lib/adminAuth.ts`) — the same gate every `/api/admin/*`
 * route already uses in production. This is NOT a new authorization system: Platform OS's own
 * per-league `getLeagueRole` (`lib/league/permissions.ts`) is the wrong tool here (it answers "is
 * this user commissioner/member of ONE league", not "may this caller aggregate data across MANY
 * leagues they may not personally belong to"), and the external, API-key/tenant-scoped Intelligence
 * API gate (`lib/decision-os/behavioral/api/gate.ts`) is the wrong tool too (that's for external,
 * multi-tenant, hosted consumption — a materially different, already-separately-ADR'd concern, see
 * `docs/os/PLATFORM_INTELLIGENCE_CUTOVER_ADR.md`). A site admin querying an explicit list of AF
 * league IDs for internal operator visibility is the correct, narrowest fit already available.
 *
 * Explicit-list-only is enforced one layer up, by the route (`app/api/decision-os/platform-os/route.ts`)
 * refusing an empty/missing `leagueIds` param — this module only answers "who", never "which leagues".
 */
import { requireAdmin as defaultRequireAdmin } from '@/lib/adminAuth'

export type RequireAdminFn = typeof defaultRequireAdmin

export interface PlatformOsAuthorizationDeps {
  requireAdmin: RequireAdminFn
}

const defaultDeps: PlatformOsAuthorizationDeps = { requireAdmin: defaultRequireAdmin }

export type PlatformOsAuthorizationResult =
  | { authorized: true; adminUserId: string }
  | { authorized: false; status: 401 | 403 }

/**
 * Authorizes a Platform OS request. Never throws — a failure inside `requireAdmin` itself would be
 * a real bug in that shared gate, not something this thin wrapper should mask, but `requireAdmin`
 * already has its own never-throws contract (it degrades to `unauthenticated`/`forbidden`, never an
 * exception), so no additional try/catch is added here.
 */
export async function authorizePlatformOsRequest(
  deps: PlatformOsAuthorizationDeps = defaultDeps,
): Promise<PlatformOsAuthorizationResult> {
  const gate = await deps.requireAdmin()
  if (!gate.ok) {
    return { authorized: false, status: gate.res.status === 403 ? 403 : 401 }
  }
  return { authorized: true, adminUserId: gate.user?.id ?? gate.user?.email ?? 'unknown-admin' }
}
