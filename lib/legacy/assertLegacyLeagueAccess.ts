import { prisma } from '@/lib/prisma'

/**
 * Access control for the legacy / Sleeper league-id space.
 *
 * Deliberately NOT `lib/league-access.ts` (singular) or `lib/league/league-access.ts` (plural):
 * both of those resolve an internal `League.id` via `prisma.league`. Routes that accept a
 * *Sleeper* league id (`LegacyLeague.sleeperLeagueId`) cannot use them — `prisma.league` never
 * matches a Sleeper id, so every caller, member or not, would be rejected with a 403.
 *
 * A user has access to a Sleeper league when the `LegacyUser` linked to their `AppUser` has
 * imported it. `LegacyLeague` is unique on `[userId, sleeperLeagueId]`, so this is an exact
 * "is this league in your imported history" check.
 *
 * Returns a result object rather than throwing: these are new call sites, and a value the caller
 * must destructure is harder to misuse than a throw a caller can forget to catch.
 */
export type LegacyLeagueAccess =
  | { ok: true; legacyUserId: string; legacyLeagueId: string }
  | { ok: false; status: 401 | 403 }

export async function resolveLegacyLeagueAccess(
  sleeperLeagueId: string,
  appUserId: string | undefined | null,
): Promise<LegacyLeagueAccess> {
  if (!appUserId) return { ok: false, status: 401 }

  const appUser = await prisma.appUser.findUnique({
    where: { id: appUserId },
    select: { legacyUserId: true },
  })
  if (!appUser?.legacyUserId) return { ok: false, status: 403 }

  const league = await prisma.legacyLeague.findFirst({
    where: { userId: appUser.legacyUserId, sleeperLeagueId },
    select: { id: true },
  })
  if (!league) return { ok: false, status: 403 }

  return { ok: true, legacyUserId: appUser.legacyUserId, legacyLeagueId: league.id }
}
