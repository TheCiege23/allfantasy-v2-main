import { prisma } from '@/lib/prisma'
import { getBlockedEitherWayUserIds } from '@/lib/moderation/BlockUserService'

/**
 * "Message this manager" from a league screen (2026-11-27): which AllFantasy account runs each team
 * in one league, keyed by every id a league screen uses for a team.
 *
 * Hockey managers leaving Yahoo's late-2026 redesign named "unable to message league mates directly
 * from their profiles". A league screen holds a TEAM, not a person, and the id it holds depends on
 * where its rows came from:
 *
 *   LeagueTeam.id        imported standings (scoring/standings, `source: 'imported'`)
 *   Roster.id            the league-page roster id (native standings `rosterId`, matchups)
 *   RedraftRoster.id     the season roster (native standings `seasonRosterId`)
 *
 * so the map is keyed by all three, each read with ITS OWN owner column:
 *
 *   LeagueTeam.claimedByUserId                      (NOT LeagueTeam.platformUserId — see leagueMates.ts)
 *   Roster.managerUserId ?? Roster.platformUserId   (managerUserId names the manager of a second team;
 *                                                    lib/league/viewerTeams.ts reads the pair the same way)
 *   RedraftRoster.ownerId
 *
 * On an imported league `Roster.platformUserId` is the PLATFORM's id (a Sleeper user id), not ours.
 * That needs no special case: only ids that resolve to an `AppUser` with a username survive, so a
 * platform id simply finds nobody and that team gets no Message button.
 *
 * What is returned is what the DM picker already shows (leagueMates.ts): username, display name,
 * avatar — never email. The viewer is left out, and so is anyone blocked in either direction; a
 * block-list read failure THROWS rather than answering "nobody is blocked".
 */

export type ManagerContact = {
  username: string
  displayName: string
  avatarUrl: string | null
}

export async function listLeagueManagerContacts(
  leagueId: string,
  viewerId: string,
): Promise<Record<string, ManagerContact>> {
  const [teams, rosters, redraftRosters, blocked] = await Promise.all([
    prisma.leagueTeam.findMany({
      where: { leagueId, claimedByUserId: { not: null } },
      select: { id: true, claimedByUserId: true },
    }),
    prisma.roster.findMany({
      where: { leagueId },
      select: { id: true, platformUserId: true, managerUserId: true },
    }),
    prisma.redraftRoster.findMany({
      where: { leagueId },
      select: { id: true, ownerId: true },
    }),
    getBlockedEitherWayUserIds(viewerId),
  ])

  const userByTeamKey = new Map<string, string>()
  for (const t of teams) if (t.claimedByUserId) userByTeamKey.set(t.id, t.claimedByUserId)
  for (const r of rosters) {
    const user = r.managerUserId ?? r.platformUserId
    if (user) userByTeamKey.set(r.id, user)
  }
  for (const r of redraftRosters) if (r.ownerId) userByTeamKey.set(r.id, r.ownerId)

  const candidateIds = [...new Set(userByTeamKey.values())].filter((id) => id !== viewerId && !blocked.has(id))
  if (candidateIds.length === 0) return {}

  const users = await prisma.appUser.findMany({
    where: { id: { in: candidateIds } },
    // 🛑 Four columns, named. Never `email`.
    select: { id: true, username: true, displayName: true, avatarUrl: true },
  })
  const contactByUser = new Map<string, ManagerContact>()
  for (const u of users) {
    const username = (u.username ?? '').trim()
    if (!username || u.id === viewerId || blocked.has(u.id)) continue
    contactByUser.set(u.id, { username, displayName: (u.displayName ?? '').trim() || username, avatarUrl: u.avatarUrl ?? null })
  }

  const out: Record<string, ManagerContact> = {}
  for (const [teamKey, userId] of userByTeamKey) {
    const contact = contactByUser.get(userId)
    if (contact) out[teamKey] = contact
  }
  return out
}
