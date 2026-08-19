/**
 * Fantasy OS Suite — Phase OS-A2: League Context Wiring.
 *
 * Who may MUTATE a league's financial context (confirm free/paid, or reset to unknown). Combines two
 * already-existing, already-tested gates rather than inventing a new one:
 *   - `getLeagueRole` (`lib/league/permissions.ts`) — the commissioner or a co-commissioner of THIS
 *     specific league, the natural owner of "is our own league paid or free."
 *   - `requireAdmin` (`lib/adminAuth.ts`) — the same internal site-admin gate Platform OS reuses
 *     (Phase D Increment 11), for operator-level correction/support cases.
 *
 * Reads are NOT gated by this module — that's `leagueReadAuthorization.ts`'s job (`authorizeLeagueRead`),
 * used directly by `app/api/decision-os/league-context/route.ts`'s own `GET` handler. Phase OS-C6.1
 * closed a real gap this module's own comment used to describe as intentional: every Decision OS read
 * route, including this one, previously allowed any authenticated caller to query any `leagueId` with
 * no per-league membership check. See `docs/os/FANTASY_OS_PRODUCTION_READINESS_AUDIT.md` and
 * `leagueReadAuthorization.ts`'s own header comment for the full history.
 */
import { getLeagueRole as defaultGetLeagueRole } from '@/lib/league/permissions'
import { requireAdmin as defaultRequireAdmin } from '@/lib/adminAuth'

export type GetLeagueRoleFn = typeof defaultGetLeagueRole
export type RequireAdminFn = typeof defaultRequireAdmin

export interface LeagueContextAuthorizationDeps {
  getLeagueRole: GetLeagueRoleFn
  requireAdmin: RequireAdminFn
}

const defaultDeps: LeagueContextAuthorizationDeps = {
  getLeagueRole: defaultGetLeagueRole,
  requireAdmin: defaultRequireAdmin,
}

export type LeagueContextAuthorizationResult =
  | { authorized: true; via: 'commissioner' | 'co_commissioner' | 'site_admin' }
  | { authorized: false; status: 401 | 403 }

/**
 * Never throws — `getLeagueRole`/`requireAdmin` already have their own never-throws contracts.
 */
export async function authorizeLeagueContextMutation(
  leagueId: string,
  userId: string | null | undefined,
  deps: LeagueContextAuthorizationDeps = defaultDeps,
): Promise<LeagueContextAuthorizationResult> {
  if (!userId) {
    return { authorized: false, status: 401 }
  }

  const role = await deps.getLeagueRole(leagueId, userId)
  if (role === 'commissioner') return { authorized: true, via: 'commissioner' }
  if (role === 'co_commissioner') return { authorized: true, via: 'co_commissioner' }

  const adminGate = await deps.requireAdmin()
  if (adminGate.ok) return { authorized: true, via: 'site_admin' }

  return { authorized: false, status: 403 }
}
