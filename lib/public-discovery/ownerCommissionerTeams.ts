import { prisma } from "@/lib/prisma"
import { isSystemLeagueOwner } from "@/lib/league-import/systemLeagueOwner"
import { provenClaimedCommissionerIds } from "@/lib/commissioner/leagueCommissionerAccount"

/**
 * Whose account a league's listing belongs to. Almost always the owner (`League.userId`).
 *
 * The exception is a league owned by the AllFantasy SYSTEM account: a public ESPN league people
 * joined by picking a team (lib/league-import/systemLeagueOwner.ts). Nobody owns that row, so its
 * listing belongs to the member PROVEN (with their own ESPN cookies) to hold the team ESPN flags as
 * league manager. 🛑 Never someone who only picked that team: absent from the map means nobody may
 * list the league, which is what reading the system account always produced.
 *
 * Person-owned leagues cost no query.
 */
export async function listingAccountIds(
  leagues: Array<{ id: string; userId: string | null }>
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const systemOwned: string[] = []
  for (const league of leagues) {
    if (!league.userId) continue
    if (isSystemLeagueOwner(league.userId)) systemOwned.push(league.id)
    else out.set(league.id, league.userId)
  }
  if (systemOwned.length > 0) {
    for (const [leagueId, accountId] of await provenClaimedCommissionerIds(systemOwned)) out.set(leagueId, accountId)
  }
  return out
}

export async function listingAccountId(league: { id: string; userId: string | null }): Promise<string | null> {
  return (await listingAccountIds([league])).get(league.id) ?? null
}

/**
 * Imported leagues whose AllFantasy owner holds the team the source platform marked as its head
 * commissioner — `LeagueTeam.isCommissioner` (Sleeper's `is_owner`) on a team they claimed, not a
 * viewer. The same rule as lib/commissioner/permissions.ts and the Clubhouse badge.
 *
 * 🛑 WHY THIS EXISTS. listingVerification first read only `League.isCommissioner` and the
 * import's `commissionerVerification` record. The Sleeper import sets neither: measured
 * 2026-10-31, 531 Sleeper leagues and not one with `League.isCommissioner`, while 51 of them had
 * a claimed commissioner team for a single user. So no Sleeper commissioner could list a league.
 * The commissioner flag lives on the TEAM, and this reads it there.
 *
 * One query for any number of leagues. Listing account only (listingAccountIds above): the owner,
 * or the proven commissioner of a system-owned league. Never any other member.
 */
export async function leaguesWhoseOwnerCommissions(
  leagues: Array<{ id: string; userId: string }>
): Promise<Set<string>> {
  if (leagues.length === 0) return new Set<string>()
  return leaguesCommissionedByAccount(await listingAccountIds(leagues))
}

/** As above, for callers that already resolved each league's listing account. */
export async function leaguesCommissionedByAccount(ownerById: Map<string, string>): Promise<Set<string>> {
  const out = new Set<string>()
  if (ownerById.size === 0) return out
  const teams = await prisma.leagueTeam.findMany({
    where: {
      leagueId: { in: [...ownerById.keys()] },
      claimedByUserId: { in: [...new Set(ownerById.values())] },
      isCommissioner: true,
      role: { not: "viewer" },
    },
    select: { leagueId: true, claimedByUserId: true, isCommissioner: true, role: true },
  })
  // Re-checked, not only in `where`: this grants a "verified commissioner" label, so a query
  // that loses a filter must fail closed.
  for (const team of teams) {
    if (team.isCommissioner === true && team.role !== "viewer" && team.claimedByUserId === ownerById.get(team.leagueId)) {
      out.add(team.leagueId)
    }
  }
  return out
}

export async function ownerCommissions(league: { id: string; userId: string }): Promise<boolean> {
  return (await leaguesWhoseOwnerCommissions([league])).has(league.id)
}
