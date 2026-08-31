/**
 * The other half of this league's franchise, for the league home.
 *
 * 🛑 THE ASK WAS "THE 2 LEAGUES NEED TO FEEL LIKE ITS ONE AND BE SHOWN ON 1
 * SCREEN" — click the NFL league and see NFL first with C2C beneath, and the
 * reverse from the other side. Everything needed for that already existed and
 * nothing joined it up:
 *
 *   FranchiseLink / FranchiseLeagueMember   models the pair, roles pro+college
 *   loadFranchiseDetail                     renders BOTH halves as one team
 *   /api/legacy/franchise                   serves it
 *
 * What was missing: no action could attach the pro side (see
 * `lib/franchise/pairableLeagues.ts`), and no screen ever asked. So the pairing
 * could not be created, and would not have been shown if it had been.
 *
 * ⚠ THIS RESOLVES BY LEAGUE, NOT BY FRANCHISE, and that is the whole reason it
 * is a separate module from `franchiseService`. The league home knows one
 * league id and has no idea whether it is the pro or the college half — so the
 * lookup has to run in both directions and report which side the viewer is
 * standing on. `loadFranchiseDetail` takes a linkId, which the league home does
 * not have.
 *
 * ⚠ AND IT RESOLVES THROUGH TWO ID SPACES. `FranchiseLeagueMember.leagueId`
 * holds `League.id` for the pro side and `FantraxLeague.id` for the college
 * side — the schema says so in its own comment. A Fantrax league reached from
 * the league home arrives as a `League` row whose `platformLeagueId` IS that
 * snapshot uuid, so finding its membership means looking up the snapshot id, not
 * the League id. Searching only one space makes a correctly paired Fantrax
 * league report itself unpaired.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import type { FranchiseRole } from '@/lib/franchise/franchiseLink'

export type PairedHalf = {
  linkId: string
  franchiseName: string
  /** Which half the league being viewed is. */
  viewingRole: FranchiseRole
  /** The other half. Null when the franchise only has one side attached. */
  other: {
    role: FranchiseRole
    platform: string
    /** Route target for the other half, when it is a League we can link to. */
    leagueId: string | null
    name: string
    season: number | null
    teamLabel: string | null
    /** Roster size, or null when the other half's roster cannot be read. */
    playerCount: number | null
    unavailableReason: string | null
  } | null
}

/**
 * The (platform, leagueId) pair that identifies this league to the franchise
 * tables — which is NOT always the League row's own id.
 */
async function membershipKeyFor(
  leagueId: string,
): Promise<{ platform: string; memberLeagueId: string } | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, platform: true, platformLeagueId: true },
  })
  if (!league) return null
  const platform = String(league.platform ?? '').toLowerCase()
  /*
   * ⚠ FANTRAX IS STORED UNDER THE SNAPSHOT ID. `importFantraxLeague` writes a
   * `FantraxLeague` row and the League's `platformLeagueId` is that row's uuid;
   * `attachToFranchise` is called with the snapshot id. Using `League.id` here
   * finds nothing and the league reports itself unpaired while it is paired.
   */
  if (platform === 'fantrax' && league.platformLeagueId) {
    return { platform, memberLeagueId: league.platformLeagueId }
  }
  return { platform, memberLeagueId: league.id }
}

/**
 * Resolve the franchise this league belongs to, and its other half.
 *
 * Returns null when the league is in no franchise — which is the ordinary case
 * and not an error. The caller decides whether to offer pairing.
 */
export async function resolvePairedHalf(
  leagueId: string,
  ownerUserId: string,
): Promise<PairedHalf | null> {
  const key = await membershipKeyFor(leagueId)
  if (!key) return null

  const membership = await prisma.franchiseLeagueMember.findFirst({
    where: {
      platform: key.platform,
      leagueId: key.memberLeagueId,
      /* Gated on ownership like every other franchise read — a franchise says
         which teams belong to someone. */
      link: { ownerUserId },
    },
    select: {
      role: true,
      link: { select: { id: true, name: true, members: true } },
    },
  })
  if (!membership?.link) return null

  const viewingRole = membership.role as FranchiseRole
  const otherMember = membership.link.members.find(
    (m) => !(m.platform === key.platform && m.leagueId === key.memberLeagueId),
  )

  const base = {
    linkId: membership.link.id,
    franchiseName: membership.link.name,
    viewingRole,
  }
  if (!otherMember) return { ...base, other: null }

  const otherPlatform = String(otherMember.platform ?? '').toLowerCase()

  if (otherPlatform === 'fantrax') {
    const snap = await prisma.fantraxLeague.findUnique({
      where: { id: otherMember.leagueId },
      select: { id: true, leagueName: true, season: true, userTeam: true, roster: true },
    })
    /*
     * The League row that mirrors this snapshot, so the other half is clickable.
     * Null is fine — the panel still names the league, it just does not link.
     */
    const mirror = snap
      ? await prisma.league.findFirst({
          where: { platform: 'fantrax', platformLeagueId: snap.id, userId: ownerUserId },
          select: { id: true },
        })
      : null
    const roster = Array.isArray(snap?.roster) ? (snap?.roster as unknown[]) : null
    return {
      ...base,
      other: {
        role: otherMember.role as FranchiseRole,
        platform: otherPlatform,
        leagueId: mirror?.id ?? null,
        name: snap?.leagueName ?? 'Fantrax league',
        season: snap?.season ?? null,
        teamLabel: snap?.userTeam ?? otherMember.teamExternalId,
        playerCount: roster?.length ?? null,
        unavailableReason:
          snap == null
            ? 'the linked Fantrax league no longer exists'
            : roster == null
              ? 'this Fantrax snapshot holds no roster — re-run the import'
              : null,
      },
    }
  }

  const other = await prisma.league.findUnique({
    where: { id: otherMember.leagueId },
    select: { id: true, name: true, season: true },
  })
  /*
   * ⚠ THE ROSTER COUNT IS READ FROM THE CLAIMED TEAM, NOT FROM THE LEAGUE. A
   * league-wide count would report every manager's players as yours.
   */
  const team = other
    ? await prisma.leagueTeam.findFirst({
        where: { leagueId: other.id, claimedByUserId: ownerUserId },
        select: { teamName: true, ownerName: true, externalId: true, platformUserId: true },
      })
    : null
  /*
   * ⚠ `Roster` KEYS ON `platformUserId`, NOT ON THE TEAM'S `externalId`. They are
   * different columns holding different id spaces — `@@unique([leagueId,
   * platformUserId])` is the roster's key. Querying the wrong one returns null
   * for a team that has a full roster, which renders as "no roster on file" and
   * reads as broken ingestion rather than a wrong join.
   *
   * ⚠ AND WITHOUT A TEAM THERE IS NO ROSTER TO READ. Falling back to "any roster
   * in the league" would attribute a stranger's squad to the viewer, which is
   * the same failure `importFantraxLeague` refuses to make when it will not guess
   * which team is yours.
   */
  const roster =
    other && team?.platformUserId
      ? await prisma.roster
          .findFirst({
            where: { leagueId: other.id, platformUserId: team.platformUserId },
            select: { playerData: true },
          })
          .catch(() => null)
      : null
  const players = (() => {
    const data = roster?.playerData as { players?: unknown[] } | null | undefined
    return Array.isArray(data?.players) ? data.players.length : null
  })()

  return {
    ...base,
    other: {
      role: otherMember.role as FranchiseRole,
      platform: otherPlatform,
      leagueId: other?.id ?? null,
      name: other?.name?.trim() || 'League',
      season: other?.season ?? null,
      teamLabel: team?.teamName?.trim() || team?.ownerName?.trim() || otherMember.teamExternalId,
      playerCount: players,
      unavailableReason:
        other == null
          ? 'the linked league no longer exists'
          : players == null
            ? 'no roster is on file for your team in that league'
            : null,
    },
  }
}
