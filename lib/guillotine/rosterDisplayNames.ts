import { prisma } from '@/lib/prisma'

/**
 * The one place a guillotine roster id becomes a name another manager can see.
 *
 * 🛑 THIS REPLACED THREE COPIES THAT FELL BACK TO `AppUser.email`. The danger-tier engine, the
 * survival-standings projection and the elimination engine each resolved names as
 * `u.displayName || u.email || u.id`. Every one of those names is shown to OTHER members of the
 * league: danger tiers and standings render on the guillotine home and are written into Chimmy's
 * prompts, and the elimination engine posts the chopped manager's name into league chat. Any
 * manager without a display name had their email address published to the whole league.
 *
 * Order, league-scoped first because it is what the league itself calls the team:
 *   1. LeagueTeam.ownerName   (matched on Roster.platformUserId === LeagueTeam.externalId)
 *   2. LeagueTeam.teamName
 *   3. AppUser.displayName
 *   4. @AppUser.username
 *
 * ⚠ `email` IS NOT SELECTED, NOT MERELY UNUSED. A select that fetches it keeps one refactor away
 * from rendering it again; a select that never reads it cannot.
 *
 * ⚠ SCOPED TO ONE LEAGUE. `platformUserId` is a provider id for imported leagues and the same
 * person carries it in every league they play — an unscoped team lookup would hand back a name
 * from a different league. Same reason as lib/commissioner-managers/managerNames.ts.
 *
 * Returns only rosters it could name. Callers choose their own fallback; none may be an email.
 */
export async function resolveRosterDisplayNames(
  leagueId: string,
  rosterIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(rosterIds.filter((id) => typeof id === 'string' && id.length > 0))]
  const names = new Map<string, string>()
  if (ids.length === 0) return names

  const rosters = await prisma.roster.findMany({
    where: { leagueId, id: { in: ids } },
    select: { id: true, platformUserId: true },
  })
  const ownerIds = [
    ...new Set(
      rosters
        .map((r) => r.platformUserId)
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0),
    ),
  ]
  if (ownerIds.length === 0) return names

  const [teams, users] = await Promise.all([
    prisma.leagueTeam.findMany({
      where: { leagueId, externalId: { in: ownerIds } },
      select: { externalId: true, ownerName: true, teamName: true },
    }),
    prisma.appUser.findMany({
      where: { id: { in: ownerIds } },
      select: { id: true, displayName: true, username: true },
    }),
  ])

  // Both LeagueTeam columns are non-null in the schema but hold '' for unclaimed teams; empty is not a name.
  const teamName = new Map<string, string>()
  for (const t of teams) {
    const name = t.ownerName?.trim() || t.teamName?.trim()
    if (name && !teamName.has(t.externalId)) teamName.set(t.externalId, name)
  }
  const userName = new Map<string, string>()
  for (const u of users) {
    const name = u.displayName?.trim() || (u.username?.trim() ? `@${u.username.trim()}` : '')
    if (name) userName.set(u.id, name)
  }

  for (const r of rosters) {
    const name = teamName.get(r.platformUserId) ?? userName.get(r.platformUserId)
    if (name) names.set(r.id, name)
  }
  return names
}
