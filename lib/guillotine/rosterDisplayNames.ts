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
    select: { id: true, platformUserId: true, redraftRosterId: true },
  })
  const ownerIds = [
    ...new Set(
      rosters
        .map((r) => r.platformUserId)
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0),
    ),
  ]
  const [teams, users] = ownerIds.length === 0 ? [[], []] : await Promise.all([
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

  /*
   * 🛑 A TEAM NOBODY HAD CLAIMED WAS "A TEAM" ON EVERY GUILLOTINE SCREEN. An open seat's roster is
   * owned by a placeholder ("open-slot-<league>-3"), which matches no league team and no user, so the
   * chop line, the survival standings and the chopped list all fell back to "A team" for it. Walking a
   * league locally (2026-11-20), seven of eight teams read "A team" and three chops were unnamed. The
   * season's own roster row carries the seat's name ("Open Team 3", or the name an AI manager's team
   * was given), so a roster still unnamed takes that. A value holding an "@" is never used: these names
   * go on screen and into prompts, and an owner name can be an email.
   */
  const unnamed = rosters.filter((r) => !names.has(r.id) && r.redraftRosterId)
  if (unnamed.length > 0) {
    const seats = await prisma.redraftRoster
      .findMany({ where: { id: { in: unnamed.map((r) => r.redraftRosterId as string) } }, select: { id: true, teamName: true } })
      .catch(() => [] as Array<{ id: string; teamName: string | null }>)
    const seatName = new Map(seats.map((x) => [x.id, x.teamName?.trim() ?? '']))
    for (const r of unnamed) {
      const name = seatName.get(r.redraftRosterId as string)
      if (name && !name.includes('@')) names.set(r.id, name)
    }
  }
  return names
}
