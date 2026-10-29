/**
 * Human names for a Zombie league's teams and managers.
 *
 * 🛑 NATIVE ZOMBIE LEAGUES SHOWED RAW IDS. `ZombieLeagueTeam.displayName` / `fantasyTeamName` were never
 * written for a native league (`ensureLeagueTeamRows` created bare rows), so every hub screen that reads
 * `fantasyTeamName || displayName || rosterId` — standings, chat, matchups, the commissioner override —
 * printed a roster uuid. And `selectWhisperer` stored `appUser.displayName ?? userId`: `displayName` is
 * optional and usually null, so the Whisperer's record carried the manager's user id as their name.
 *
 * One rule here, never an id:
 *   - team name: the league team (shared roster↔team rule, `matchTeamIdForRoster`), else the season roster;
 *   - manager name: the person (`UserProfile.displayName`, `AppUser.displayName`, `AppUser.username`), else
 *     the league team's / season roster's owner name. An open or orphaned seat has no manager.
 */
import { prisma } from '@/lib/prisma'
import { matchTeamIdForRoster, type TeamIdentityRow } from '@/lib/leagues/rosterTeamIdentity'

/** A seat nobody plays: an open slot, an orphaned import, or a native open seat (`roster:<id>`). */
export function isUnmannedSeat(platformUserId: string | null | undefined): boolean {
  return !platformUserId || /^(open-slot-|orphan-|roster:)/.test(platformUserId)
}

export type ZombieNameRoster = {
  id: string
  platformUserId: string | null
  playerData: unknown
  redraftRoster?: { teamName: string | null; ownerName: string | null } | null
}
export type ZombieNameTeam = TeamIdentityRow & { id: string; teamName: string | null; ownerName: string | null }
export type ZombieNamePerson = { displayName: string | null; username: string | null }

const clean = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Pure. `people` is keyed by user id. */
export function resolveZombieNames(
  rosters: readonly ZombieNameRoster[],
  teams: readonly ZombieNameTeam[],
  people: ReadonlyMap<string, ZombieNamePerson>,
): Map<string, { teamName: string | null; managerName: string | null }> {
  const out = new Map<string, { teamName: string | null; managerName: string | null }>()
  for (const roster of rosters) {
    const teamId = matchTeamIdForRoster(roster, teams)
    const team = teamId ? teams.find((t) => t.id === teamId) : undefined
    const teamName = clean(team?.teamName) ?? clean(roster.redraftRoster?.teamName)
    let managerName: string | null = null
    if (!isUnmannedSeat(roster.platformUserId)) {
      const person = people.get(roster.platformUserId!)
      managerName =
        clean(person?.displayName) ??
        clean(person?.username) ??
        clean(team?.ownerName) ??
        clean(roster.redraftRoster?.ownerName)
    }
    out.set(roster.id, { teamName, managerName })
  }
  return out
}

/** The display name of one person, or null — never their id. */
export async function resolveManagerName(userId: string | null | undefined): Promise<string | null> {
  if (isUnmannedSeat(userId)) return null
  const [profile, user] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId: userId! }, select: { displayName: true } }),
    prisma.appUser.findUnique({ where: { id: userId! }, select: { displayName: true, username: true } }),
  ])
  return clean(profile?.displayName) ?? clean(user?.displayName) ?? clean(user?.username)
}

/**
 * A Whisperer record with a readable `displayName`. Records written before `selectWhisperer` was fixed
 * hold the user id there; this repairs them on read rather than needing a backfill. Only for a viewer
 * already allowed to see the Whisperer — redaction runs first, never instead.
 */
export async function withWhispererDisplayName<T extends { userId: string; displayName: string | null }>(
  record: T | null | undefined,
): Promise<T | null> {
  if (!record) return null
  const stored = clean(record.displayName)
  if (stored && stored !== record.userId) return record
  return { ...record, displayName: (await resolveManagerName(record.userId).catch(() => null)) ?? 'The Whisperer' }
}

/** Every roster's team and manager name for a league. */
export async function loadZombieNames(leagueId: string) {
  const [rosters, teams] = await Promise.all([
    prisma.roster.findMany({
      where: { leagueId },
      select: {
        id: true,
        platformUserId: true,
        playerData: true,
        redraftRoster: { select: { teamName: true, ownerName: true } },
      },
    }),
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { id: true, teamName: true, ownerName: true, externalId: true, platformUserId: true, claimedByUserId: true },
    }),
  ])
  const userIds = [...new Set(rosters.map((r) => r.platformUserId).filter((id): id is string => !isUnmannedSeat(id)))]
  const [profiles, users] = userIds.length
    ? await Promise.all([
        prisma.userProfile.findMany({ where: { userId: { in: userIds } }, select: { userId: true, displayName: true } }),
        prisma.appUser.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, username: true } }),
      ])
    : [[], []]
  const people = new Map<string, ZombieNamePerson>()
  for (const id of userIds) {
    const profile = profiles.find((p) => p.userId === id)
    const user = users.find((u) => u.id === id)
    people.set(id, { displayName: clean(profile?.displayName) ?? clean(user?.displayName), username: clean(user?.username) })
  }
  return resolveZombieNames(rosters, teams, people)
}

/**
 * Write each team's names onto its `ZombieLeagueTeam` row (`fantasyTeamName`, `displayName`). Runs at
 * activation and again every weekly resolution, so a claimed seat or a renamed team catches up within a
 * week. Only rows whose names changed are written, and an existing name is kept when nothing better
 * resolves. Returns how many rows were written.
 */
export async function syncZombieTeamNames(leagueId: string): Promise<number> {
  const [names, rows] = await Promise.all([
    loadZombieNames(leagueId),
    prisma.zombieLeagueTeam.findMany({ where: { leagueId }, select: { rosterId: true, displayName: true, fantasyTeamName: true } }),
  ])
  let written = 0
  for (const row of rows) {
    const n = names.get(row.rosterId)
    if (!n) continue
    // Never trade a name for null: an imported league may carry names this resolver cannot rebuild.
    const teamName = n.teamName ?? row.fantasyTeamName
    const managerName = n.managerName ?? row.displayName
    if (row.fantasyTeamName === teamName && row.displayName === managerName) continue
    await prisma.zombieLeagueTeam.update({
      where: { leagueId_rosterId: { leagueId, rosterId: row.rosterId } },
      data: { fantasyTeamName: teamName, displayName: managerName },
    })
    written++
  }
  return written
}
