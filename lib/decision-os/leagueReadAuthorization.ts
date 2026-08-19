/**
 * Fantasy OS Suite — Phase OS-C6.1: Backend Freeze Certification (Decision OS Read Authorization
 * Hardening).
 *
 * Who may READ Decision OS data scoped to one specific league? Reuses the EXISTING, already-real,
 * already-tested per-league role resolver (`getLeagueRole`, `lib/league/permissions.ts`) — the same
 * function every league settings route already uses to gate WRITES via `requireCommissionerRole`/
 * `requireCommissionerOnly`. This module adds no new role concept and no new database query; it only
 * wraps `getLeagueRole`'s own output in the same `{authorized, status}` discriminated-union shape every
 * sibling Decision OS authorization module already uses (`leagueContextAuthorization.ts`,
 * `platformOsAuthorization.ts`).
 *
 * Allows: commissioner, co-commissioner, member, and viewer — any real, granted relationship to the
 * league. `viewer` is included deliberately: it is itself a real, commissioner-granted role (per
 * `getLeagueRole`'s own return type), and excluding it would be a new, additional restriction beyond
 * "not a member" — the exact opposite of what a real viewer's own granted role means.
 *
 * Denies: unauthenticated callers (401) and authenticated callers with NO relationship to the league
 * at all — `getLeagueRole` returning `null` (403). This closes the real gap
 * `docs/os/FANTASY_OS_PRODUCTION_READINESS_AUDIT.md` found: several Decision OS read routes previously
 * relied solely on "the UI only ever calls these for leagues the signed-in user is actually related
 * to," which is not a real authorization boundary — any authenticated caller who obtained a real
 * league's UUID could read that league's real Decision OS data regardless of membership.
 */
import { getLeagueRole as defaultGetLeagueRole, type LeagueRole } from '@/lib/league/permissions'

export type GetLeagueRoleFn = typeof defaultGetLeagueRole

export interface LeagueReadAuthorizationDeps {
  getLeagueRole: GetLeagueRoleFn
}

const defaultDeps: LeagueReadAuthorizationDeps = { getLeagueRole: defaultGetLeagueRole }

export type LeagueReadAuthorizationResult =
  | { authorized: true; role: NonNullable<LeagueRole> }
  | { authorized: false; status: 401 | 403 }

/**
 * Authorizes a read of one league's Decision OS data. Never throws — `getLeagueRole` is a plain,
 * already-tested Prisma read with no throwing contract of its own; this wrapper adds none either,
 * matching every sibling Decision OS authorization module's own never-throws precedent.
 */
export async function authorizeLeagueRead(
  leagueId: string,
  userId: string | null | undefined,
  deps: LeagueReadAuthorizationDeps = defaultDeps,
): Promise<LeagueReadAuthorizationResult> {
  if (!userId) {
    return { authorized: false, status: 401 }
  }

  const role = await deps.getLeagueRole(leagueId, userId)
  if (!role) {
    return { authorized: false, status: 403 }
  }

  return { authorized: true, role }
}
