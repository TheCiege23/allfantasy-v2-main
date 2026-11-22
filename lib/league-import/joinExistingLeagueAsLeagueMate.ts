/**
 * A league mate with no team of their own joins the copy of a league that is already here.
 *
 * Owner's rule, 2026-11-21: "everyone sees the same copy of the league and not their own version of
 * it". The import already joined a second account to the existing copy when it could claim their own
 * team (`claimExistingLeagueForMember`) or when they were a proven commissioner
 * (`joinExistingLeagueAsCoCommissioner`). Everyone else fell through to creating a second copy:
 *
 *   - a CO-OWNER, whose provider id is on a team's co-owner list and not its owner field. They join
 *     the same team, in the same role, as an accepted `TeamCoOwner` (lib/team-coowners);
 *   - a member with NO TEAM (chopped in a guillotine league, voted out of a survivor league). The
 *     provider still lists them in the league, so they join as a viewer (lib/league/importViewers.ts).
 *
 * Both need `sourceManagerId`: the caller's own id on the provider, proven by the provider through the
 * import gate, never typed in. Someone the provider cannot vouch for is not joined to anything here;
 * the caller refuses that import and points them at the commissioner's invite link.
 *
 * Returns null when there is no other account's copy, so an ordinary first import is untouched.
 */
import { platformLeagueIdWhere } from './samePlatformLeague'
import { prisma } from '@/lib/prisma'
import { IMPORT_VIEWERS_KEY, importViewerIds } from '@/lib/league/importViewers'
import { readSourceTeamId } from '@/lib/leagues/rosterTeamIdentity'

export type LeagueMateJoin = { leagueId: string; name: string; sport: string; joinedAs: 'co_owner' | 'viewer'; alreadyJoined: boolean }

type CoOwnedRoster = { source_team_id: string; co_owner_ids?: string[] | null }

/** Pure: the provider team this manager co-owns, if any. */
export function coOwnedSourceTeamId(rosters: ReadonlyArray<CoOwnedRoster> | null | undefined, sourceManagerId: string): string | null {
  const id = sourceManagerId.trim()
  if (!id) return null
  const hit = (rosters ?? []).find((r) => Array.isArray(r.co_owner_ids) && r.co_owner_ids.includes(id))
  return hit ? String(hit.source_team_id) : null
}

/** Whether another account already holds a copy of this provider league. */
export async function otherAccountsCopy(args: { userId: string; provider: string; platformLeagueId: string; seasonYear: number }) {
  return prisma.league.findFirst({
    where: { userId: { not: args.userId }, platform: args.provider, platformLeagueId: await platformLeagueIdWhere(args.provider, args.platformLeagueId), season: args.seasonYear },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, sport: true, userId: true, settings: true },
  })
}

export async function joinExistingLeagueAsLeagueMate(args: {
  userId: string
  provider: string
  platformLeagueId: string
  seasonYear: number
  sourceManagerId: string
  rosters: ReadonlyArray<CoOwnedRoster> | null | undefined
}): Promise<LeagueMateJoin | null> {
  const { userId } = args
  const other = await otherAccountsCopy(args)
  if (!other) return null
  const base = { leagueId: other.id, name: other.name ?? '', sport: String(other.sport ?? '') }

  const teamId = coOwnedSourceTeamId(args.rosters, args.sourceManagerId)
  if (teamId) {
    const rosters = await prisma.roster.findMany({ where: { leagueId: other.id }, select: { id: true, platformUserId: true, playerData: true } })
    const roster = rosters.find((r) => readSourceTeamId(r) === teamId)
    if (roster) {
      const existing = await prisma.teamCoOwner.findUnique({ where: { leagueId_userId: { leagueId: other.id, userId } }, select: { rosterId: true, acceptedAt: true } })
      if (existing?.acceptedAt && existing.rosterId === roster.id) return { ...base, joinedAs: 'co_owner', alreadyJoined: true }
      // An imported team is keyed by the provider's team id, not the roster id, so `acceptedCoOwnerRosterId`
      // finds no team row for it and compares against a null claimant: store null, as it expects.
      const data = { rosterId: roster.id, invitedByUserId: other.userId, rosterOwnerKey: roster.platformUserId, claimedOwnerId: null, acceptedAt: new Date() }
      await prisma.teamCoOwner.upsert({
        where: { leagueId_userId: { leagueId: other.id, userId } },
        create: { leagueId: other.id, userId, ...data },
        update: data,
      })
      return { ...base, joinedAs: 'co_owner', alreadyJoined: false }
    }
  }

  const alreadyViewer = await prisma.$transaction(async (tx) => {
    const row = await tx.league.findUnique({ where: { id: other.id }, select: { settings: true } })
    const settings = row?.settings && typeof row.settings === 'object' && !Array.isArray(row.settings) ? (row.settings as Record<string, unknown>) : {}
    const current = importViewerIds(settings)
    if (current.includes(userId)) return true
    await tx.league.update({ where: { id: other.id }, data: { settings: { ...settings, [IMPORT_VIEWERS_KEY]: [...current, userId].sort() } as object } })
    return false
  })
  return { ...base, joinedAs: 'viewer', alreadyJoined: alreadyViewer }
}
