/**
 * Who holds each seat in a league — the ONE writer for putting a person into a team or taking
 * them out, and the one count of how many seats people hold.
 *
 * 🛑 A seat is recorded in five places, and every surface reads a different one:
 *   - `Roster.platformUserId`         the draft room's pick authority (`live-draft-engine/auth.ts`)
 *   - `LeagueTeam.claimedByUserId`    the redraft routes' member check (`league/league-access.ts`)
 *   - `RedraftLeagueMember`           membership and team number
 *   - `LeagueEntrySlot.status`        open / filled seats
 *   - `RedraftRoster.ownerId`         season ownership once the draft has run
 *
 * Before this module each join path wrote its own subset: a draft-room claim or a commissioner
 * assignment set only the roster (so the manager could draft but got 403 on their own roster
 * afterwards), an invite-link claim set only the team (so the manager could never pick), and a
 * seat taken after the draft never reached `RedraftRoster.ownerId`, which the owner-repair logic
 * then refused to fix. Every path now goes through `assignLeagueSeat`.
 */
import type { Prisma } from '@prisma/client'
import { isNativePlatform } from '@/lib/league/isNativeLeague'

type Db = Prisma.TransactionClient

/**
 * Seats held by real people: rosters whose owner id is an `AppUser`.
 *
 * ⚠ Do not count "rosters that are not `orphan-*`". A native league is created with one roster
 * per seat, the open ones owned by `open-slot-<leagueId>-<n>`, so that count reads every native
 * league as full from the moment it exists — every invite code answered "League is full". The
 * join route already counted this way; the invite previews did not.
 */
export async function countSeatsHeldByPeople(db: Db, leagueId: string): Promise<number> {
  const rosters = await db.roster.findMany({ where: { leagueId }, select: { platformUserId: true } })
  const ids = [...new Set(rosters.map((r) => r.platformUserId).filter(Boolean))]
  if (ids.length === 0) return 0
  const people = await db.appUser.findMany({ where: { id: { in: ids } }, select: { id: true } })
  const personIds = new Set(people.map((p) => p.id))
  return rosters.filter((r) => personIds.has(r.platformUserId)).length
}

export type AssignLeagueSeatResult =
  | { ok: true; rosterId: string; teamNumber: number | null; alreadyHeld: boolean }
  | {
      ok: false
      code: 'ROSTER_NOT_FOUND' | 'USER_NOT_FOUND' | 'ROSTER_TAKEN' | 'ALREADY_HOLDS_ROSTER'
      message: string
    }

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Keys a season roster may carry for a seat, from the roster's and team's owners before a change. */
function seatOwnerKeys(rosterId: string, ...owners: Array<string | null | undefined>): string[] {
  const keys = new Set<string>([`roster:${rosterId}`])
  for (const owner of owners) {
    const trimmed = String(owner ?? '').trim()
    if (trimmed) keys.add(trimmed)
  }
  return [...keys]
}

/**
 * Move every season roster for this seat from its previous owner keys to `ownerId`. Skips a season
 * where `ownerId` already owns a season roster — `(seasonId, ownerId)` is unique, and a violation
 * inside a Postgres transaction aborts it, which a `.catch` cannot undo.
 */
async function moveSeasonOwnership(
  tx: Db,
  args: { leagueId: string; fromKeys: string[]; ownerId: string; ownerName: string; teamName?: string | null },
): Promise<void> {
  const from = args.fromKeys.filter((k) => k !== args.ownerId)
  if (from.length === 0) return
  const seats = await tx.redraftRoster.findMany({
    where: { leagueId: args.leagueId, ownerId: { in: from } },
    select: { id: true, seasonId: true },
  })
  if (seats.length === 0) return
  const taken = await tx.redraftRoster.findMany({
    where: { leagueId: args.leagueId, ownerId: args.ownerId, seasonId: { in: seats.map((s) => s.seasonId) } },
    select: { seasonId: true },
  })
  const takenSeasons = new Set(taken.map((t) => t.seasonId))
  for (const seat of seats) {
    if (takenSeasons.has(seat.seasonId)) continue
    await tx.redraftRoster.update({
      where: { id: seat.id },
      data: {
        ownerId: args.ownerId,
        ownerName: args.ownerName,
        ...(args.teamName ? { teamName: args.teamName } : {}),
      },
    })
  }
}

/**
 * Put `userId` in the seat held by `rosterId`.
 *
 * `replaceExisting` lets a commissioner hand a seat that a person already holds to someone else;
 * every self-service path leaves it off, so a held seat is refused.
 */
export async function assignLeagueSeat(
  tx: Db,
  args: {
    leagueId: string
    rosterId: string
    userId: string
    /** Shown as the manager's name; defaults to the user's profile name. */
    displayName?: string | null
    replaceExisting?: boolean
  },
): Promise<AssignLeagueSeatResult> {
  const { leagueId, rosterId, userId } = args

  const [league, roster, user] = await Promise.all([
    tx.league.findUnique({ where: { id: leagueId }, select: { platform: true, userId: true } }),
    tx.roster.findFirst({
      where: { id: rosterId, leagueId },
      select: { id: true, platformUserId: true, playerData: true, settings: true },
    }),
    tx.appUser.findUnique({ where: { id: userId }, select: { id: true, username: true, displayName: true, email: true } }),
  ])
  if (!league || !roster) return { ok: false, code: 'ROSTER_NOT_FOUND', message: 'Roster not found in this league.' }
  if (!user) return { ok: false, code: 'USER_NOT_FOUND', message: 'That user does not exist.' }

  const previousOwner = roster.platformUserId
  const alreadyHeld = previousOwner === userId
  if (!alreadyHeld) {
    const previousIsPerson = previousOwner
      ? Boolean(await tx.appUser.findUnique({ where: { id: previousOwner }, select: { id: true } }))
      : false
    if (previousIsPerson && !args.replaceExisting) {
      return { ok: false, code: 'ROSTER_TAKEN', message: 'That team is already claimed.' }
    }
    const other = await tx.roster.findFirst({
      where: { leagueId, platformUserId: userId, NOT: { id: rosterId } },
      select: { id: true },
    })
    if (other) {
      return { ok: false, code: 'ALREADY_HOLDS_ROSTER', message: 'You already hold a team in this league.' }
    }
  }

  const profile = await tx.userProfile.findFirst({
    where: { userId },
    select: { displayName: true, sleeperUsername: true },
  })
  const name =
    args.displayName?.trim() ||
    profile?.displayName?.trim() ||
    user.displayName?.trim() ||
    profile?.sleeperUsername?.trim() ||
    user.username?.trim() ||
    user.email?.split('@')[0]?.trim() ||
    'Manager'

  const native = isNativePlatform(league.platform)
  const playerData = asRecord(roster.playerData)
  const foundation = asRecord(playerData.foundation)
  const wasOpenTeam = foundation.openTeam === true

  const team = await tx.leagueTeam.findFirst({
    where: { leagueId, externalId: rosterId },
    select: { id: true, platformUserId: true, claimedByUserId: true, teamName: true },
  })

  const claimed = await tx.roster.updateMany({
    where: { id: rosterId, leagueId, platformUserId: previousOwner },
    data: {
      platformUserId: userId,
      ...(Object.keys(foundation).length > 0
        ? {
            playerData: {
              ...playerData,
              foundation: { ...foundation, openTeam: false, claimedBy: userId, claimedAt: new Date().toISOString() },
            } as Prisma.InputJsonValue,
          }
        : {}),
      ...(asRecord(roster.settings).openSlot === true
        ? { settings: { ...asRecord(roster.settings), openSlot: false } as Prisma.InputJsonValue }
        : {}),
    },
  })

  // Another claim may have committed after the ownership read. Never overwrite it.
  if (claimed.count !== 1) return { ok: false, code: 'ROSTER_TAKEN', message: 'That team is already claimed.' }

  // A native open team takes its manager's name; an imported team keeps the name its league gave it.
  const teamName = wasOpenTeam || !team?.teamName ? `${name}'s Team` : team.teamName
  if (team) {
    await tx.leagueTeam.update({
      where: { id: team.id },
      data: {
        ownerName: name,
        teamName,
        claimedByUserId: userId,
        isOrphan: false,
        // `getLeagueRole` trusts these flags on the claimed team, so a new holder must not
        // inherit them: handing the commissioner's team to someone else made them commissioner.
        // Only the league owner holds the head role through a team; co-commissioners are
        // re-granted deliberately, never passed along with a seat.
        ...(alreadyHeld
          ? {}
          : {
              isCommissioner: userId === league.userId,
              isCoCommissioner: false,
              role: userId === league.userId ? 'commissioner' : 'member',
            }),
        // An imported team's platformUserId is its provider manager id, which the provider sync
        // matches on. Only a native team's is ours to overwrite.
        ...(native ? { platformUserId: userId } : {}),
      },
    })
  }

  const slot = await tx.leagueEntrySlot.findFirst({
    where: { leagueId, rosterId },
    select: { id: true, slotNumber: true, status: true },
  })
  if (slot && slot.status !== 'FILLED') {
    await tx.leagueEntrySlot.update({ where: { id: slot.id }, data: { status: 'FILLED' } })
  }
  const teamNumber = slot?.slotNumber ?? (typeof foundation.slotNumber === 'number' ? foundation.slotNumber : null)

  await tx.redraftLeagueMember.upsert({
    where: { leagueId_userId: { leagueId, userId } },
    create: {
      leagueId,
      userId,
      role: league.userId === userId ? 'COMMISSIONER' : 'MEMBER',
      teamNumber,
    },
    update: teamNumber != null ? { teamNumber } : {},
  })

  if (!alreadyHeld && previousOwner && args.replaceExisting && previousOwner !== league.userId) {
    // The replaced person no longer holds a seat here.
    await tx.redraftLeagueMember.deleteMany({ where: { leagueId, userId: previousOwner } })
  }

  await moveSeasonOwnership(tx, {
    leagueId,
    fromKeys: seatOwnerKeys(rosterId, previousOwner, team?.platformUserId, team?.claimedByUserId),
    ownerId: userId,
    ownerName: name,
    teamName,
  })

  return { ok: true, rosterId, teamNumber, alreadyHeld }
}

/**
 * Take the person out of a seat and leave it open for the next join. The roster, its players and
 * its draft history stay; only the holder changes. A native seat is marked open again so the next
 * code join claims it.
 */
export async function releaseLeagueSeat(
  tx: Db,
  args: { leagueId: string; rosterId: string },
): Promise<{ ok: true; previousOwner: string | null } | { ok: false; code: 'ROSTER_NOT_FOUND' }> {
  const { leagueId, rosterId } = args
  const [league, roster] = await Promise.all([
    tx.league.findUnique({ where: { id: leagueId }, select: { platform: true, userId: true } }),
    tx.roster.findFirst({ where: { id: rosterId, leagueId }, select: { id: true, platformUserId: true, playerData: true } }),
  ])
  if (!league || !roster) return { ok: false, code: 'ROSTER_NOT_FOUND' }

  const previousOwner = roster.platformUserId || null
  const vacantId = `orphan-${rosterId}`
  const native = isNativePlatform(league.platform)
  const playerData = asRecord(roster.playerData)
  const foundation = asRecord(playerData.foundation)

  const team = await tx.leagueTeam.findFirst({
    where: { leagueId, externalId: rosterId },
    select: { id: true, platformUserId: true, claimedByUserId: true },
  })

  await tx.roster.update({
    where: { id: rosterId },
    data: {
      platformUserId: vacantId,
      ...(native
        ? {
            playerData: {
              ...playerData,
              foundation: { ...foundation, openTeam: true, claimedBy: null, releasedAt: new Date().toISOString() },
            } as Prisma.InputJsonValue,
          }
        : {}),
    },
  })
  if (team) {
    await tx.leagueTeam.update({
      where: { id: team.id },
      data: {
        claimedByUserId: null,
        isOrphan: true,
        isCommissioner: false,
        isCoCommissioner: false,
        ...(native ? { platformUserId: vacantId } : {}),
      },
    })
  }
  await tx.leagueEntrySlot.updateMany({ where: { leagueId, rosterId }, data: { status: 'OPEN' } })

  if (previousOwner) {
    if (previousOwner === league.userId) {
      // The commissioner keeps the league; they just no longer hold a team.
      await tx.redraftLeagueMember.updateMany({ where: { leagueId, userId: previousOwner }, data: { teamNumber: null } })
    } else {
      await tx.redraftLeagueMember.deleteMany({ where: { leagueId, userId: previousOwner } })
    }
  }

  // `roster:<id>` is the season key for a seat nobody holds; the next assignment moves it on.
  await moveSeasonOwnership(tx, {
    leagueId,
    fromKeys: seatOwnerKeys(rosterId, previousOwner, team?.platformUserId, team?.claimedByUserId).filter(
      (k) => k !== `roster:${rosterId}`,
    ),
    ownerId: `roster:${rosterId}`,
    ownerName: 'Open team',
  })

  return { ok: true, previousOwner }
}
