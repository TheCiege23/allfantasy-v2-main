import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'

export type ChimmyLeagueSnapshot = {
  id: string
  name: string | null
  sport: SupportedSport
  platform: string
  platformLeagueId: string
  season: number
  leagueSize: number | null
  scoring: string | null
  leagueVariant: string | null
  isDynasty: boolean
  status: string | null
  timezone: string | null
  lastSyncedAt: Date | null
  importBatchId: string | null
  importedAt: Date | null
}

/**
 * Why grounding produced nothing. The caller MUST be able to tell these apart:
 * "you are not in this league" and "this id is not a league at all" are both
 * reasons to refuse, but a bare `null` is also what a thrown query looks like,
 * and answering anyway is the failure this type exists to prevent.
 */
export type ChimmyLeagueGroundingFailure =
  | 'anonymous'
  /**
   * No `League` row for this id. Reached in normal use: the /core league list
   * merges rows from OTHER tables under the same `id` field — `LegacyTournament`
   * rows are emitted with `hasUnifiedRecord: true`, so they survive the
   * `playedLeagues` filter and arrive here as ids that `League` has never held.
   */
  | 'not_found'
  | 'not_member'
  /** The lookup itself failed. Never treat as "no league" — it is "unknown". */
  | 'error'

export type ChimmyLeagueGrounding =
  | { ok: true; snapshot: ChimmyLeagueSnapshot }
  | { ok: false; reason: ChimmyLeagueGroundingFailure }

const SNAPSHOT_SELECT = {
  id: true,
  name: true,
  sport: true,
  platform: true,
  platformLeagueId: true,
  season: true,
  leagueSize: true,
  scoring: true,
  leagueVariant: true,
  isDynasty: true,
  status: true,
  timezone: true,
  lastSyncedAt: true,
  importBatchId: true,
  importedAt: true,
} as const

/**
 * Grounds Chimmy in a league the user is actually in.
 *
 * ⚠ MEMBERSHIP IS `resolveLeagueMembership`, NOT A LOCAL `OR`. This file used to
 * hand-roll the predicate as `League.userId OR LeagueTeam.claimedByUserId`, which
 * is NARROWER than the list the drawer renders from
 * (`getDashboardLeagueListForUser`, which also accepts `RedraftLeagueMember`).
 * A league reachable only through the redraft path therefore appeared in the
 * scope picker and silently failed to ground — and because the route answered
 * anyway, the user got a confident reply about a roster Chimmy could not see.
 * Any predicate here that is narrower than the surface's own list predicate
 * re-creates that bug, so defer to the canonical one.
 */
export async function loadLeagueGroundingForUser(
  userId: string | null | undefined,
  leagueId: string
): Promise<ChimmyLeagueGrounding> {
  let membership: Awaited<ReturnType<typeof resolveLeagueMembership>>
  try {
    membership = await resolveLeagueMembership(leagueId, userId)
  } catch {
    return { ok: false, reason: 'error' }
  }
  if (!membership.ok) return { ok: false, reason: membership.reason }

  // Deliberately inferred, not annotated: `SNAPSHOT_SELECT` narrows the row to
  // these columns, and naming the full model type here widens it back and fails.
  let row: Pick<
    NonNullable<Awaited<ReturnType<typeof prisma.league.findUnique>>>,
    keyof typeof SNAPSHOT_SELECT
  > | null
  try {
    row = await prisma.league.findUnique({
      where: { id: leagueId },
      select: SNAPSHOT_SELECT,
    })
  } catch {
    return { ok: false, reason: 'error' }
  }
  // Membership already proved the row exists; a miss here is a race, not a denial.
  if (!row) return { ok: false, reason: 'not_found' }

  return {
    ok: true,
    snapshot: { ...row, sport: normalizeToSupportedSport(row.sport) },
  }
}

/**
 * Back-compatible shape: null collapses every failure reason. Prefer
 * `loadLeagueGroundingForUser` — callers that answer the user need to know WHY
 * grounding is missing so they can say so instead of guessing.
 */
export async function loadLeagueSnapshotForUser(
  userId: string,
  leagueId: string
): Promise<ChimmyLeagueSnapshot | null> {
  const result = await loadLeagueGroundingForUser(userId, leagueId)
  return result.ok ? result.snapshot : null
}
