import { prisma } from "@/lib/prisma"

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
 * One query for any number of leagues. Owner only: the listing belongs to whoever's row it is.
 */
export async function leaguesWhoseOwnerCommissions(
  leagues: Array<{ id: string; userId: string }>
): Promise<Set<string>> {
  const out = new Set<string>()
  if (leagues.length === 0) return out
  const ownerById = new Map(leagues.map((l) => [l.id, l.userId]))
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
