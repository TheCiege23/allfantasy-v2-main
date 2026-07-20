import { prisma } from '@/lib/prisma'

/**
 * Canonical league-membership predicate for the `League.id` (uuid) space.
 *
 * This is the ONE place that answers "is this user a member of this league."
 * A league can establish membership through four independent, equally real
 * mechanisms, and a user may be represented by only one of them:
 *
 *   1. `League.userId`              — the owner / importing commissioner
 *   2. `RedraftLeagueMember.userId` — joined/invited a native redraft league
 *   3. `LeagueTeam.claimedByUserId` — claimed a team via the native open-slot flow
 *   4. `Roster.platformUserId`      — an imported (e.g. Sleeper) manager who claimed
 *                                     their placeholder roster
 *
 * Gate on this union, never on a subset. In particular do NOT gate on
 * `LeagueTeam.platformUserId`: that column is nullable (`String?`) and is only
 * populated by the native open-slot claim path, so it is empty for imported
 * leagues — gating on it 403s real members out of their own league.
 * `Roster.platformUserId` is the always-populated counterpart (`String`, NOT NULL,
 * unique per league).
 *
 * Matching `Roster.platformUserId` against an `AppUser.id` is safe and does not
 * admit unclaimed placeholders: imports store a raw source manager id (e.g.
 * Sleeper's numeric user id) or an `"import:..."` sentinel there, and
 * `lib/league-import/placeholderClaim.ts` rewrites the column to the claiming
 * `AppUser.id` only once a real user claims it. `AppUser.id` is a uuid, so a
 * placeholder value can never collide with one.
 *
 * Note this keys on `League.id` (uuid), NOT a provider's league id — see the
 * separate Sleeper-id vs `League.id` id-space hazard before reusing it.
 */

/** Which mechanism established membership. Surfaced for debugging a 403. */
export type LeagueAccessVia = 'owner' | 'redraft_member' | 'claimed_team' | 'roster'

export interface LeagueAccessResult {
  leagueId: string
  leagueSport: string
  isCommissioner: boolean
  isMember: boolean
  isOwner: boolean
  via: LeagueAccessVia
}

export async function resolveLeagueAccess(
  leagueId: string,
  userId: string | undefined | null
): Promise<LeagueAccessResult | null> {
  if (!userId) return null

  // Resolved in ONE query with per-user filtered relations, rather than a chain of
  // follow-up lookups. This helper sits on hot paths (the dashboard fans out over every
  // league), so the query count matters, and it keeps the mock surface to a single
  // `league.findUnique` for the ~60 call sites that stub Prisma in tests.
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      sport: true,
      userId: true,
      redraftMembers: { where: { userId }, select: { role: true }, take: 1 },
      teams: {
        where: { claimedByUserId: userId },
        select: { isCommissioner: true, isCoCommissioner: true },
        take: 1,
      },
      rosters: { where: { platformUserId: userId }, select: { id: true }, take: 1 },
    },
  })
  if (!league) return null

  const base = { leagueId: league.id, leagueSport: league.sport }

  if (league.userId === userId) {
    return { ...base, isCommissioner: true, isMember: true, isOwner: true, via: 'owner' }
  }

  // Relations are read defensively: a stale test fixture that stubs `league.findUnique`
  // without them degrades to "not a member" (fail-closed) instead of throwing.
  //
  // The two commissioner-conferring paths are evaluated BEFORE `Roster`, deliberately.
  // A user can hold both a `RedraftLeagueMember` COMMISSIONER row and a `Roster` row;
  // `Roster` never confers commissioner, so matching it first would silently downgrade
  // a real commissioner to a plain member.
  const redraftMember = league.redraftMembers?.[0] ?? null
  if (redraftMember) {
    return {
      ...base,
      isCommissioner: redraftMember.role === 'COMMISSIONER',
      isMember: true,
      isOwner: false,
      via: 'redraft_member',
    }
  }

  const claimedTeam = league.teams?.[0] ?? null
  if (claimedTeam) {
    return {
      ...base,
      isCommissioner: Boolean(claimedTeam.isCommissioner || claimedTeam.isCoCommissioner),
      isMember: true,
      isOwner: false,
      via: 'claimed_team',
    }
  }

  if ((league.rosters?.length ?? 0) <= 0) return null

  return { ...base, isCommissioner: false, isMember: true, isOwner: false, via: 'roster' }
}

export async function assertLeagueMember(
  leagueId: string,
  userId: string | undefined | null
): Promise<LeagueAccessResult> {
  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access?.isMember) {
    const err = new Error('Forbidden') as Error & { status?: number }
    err.status = 403
    throw err
  }
  return access
}
