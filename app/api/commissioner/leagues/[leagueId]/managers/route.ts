import { canCommissionerAct, commissionerAccessResponse, type CommissionerNeed } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'
import { teamlessCoCommissionerIds } from '@/lib/league/tournamentCoCommissioners'
import { isOrphanPlatformUserId } from '@/lib/orphan-ai-manager/orphanRosterResolver'
import { trackDiscoveryOrphanAdoption } from '@/lib/discovery-analytics/server'
import { assignLeagueSeat, releaseLeagueSeat } from '@/lib/league/leagueSeats'
import { endManagedForNewOwners } from '@/lib/inactive-manager/inactiveManagerService'
import { readAllowMultiTeamManagers, multiTeamManagersSupported } from '@/lib/league/multiTeamManagers'
import { rosterManagerKey } from '@/lib/league/rosterManager'
import { readDivisionConfig } from '@/lib/league/divisions/leagueDivisions'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { managerTeamNameEditsAllowed, normalizeTeamAbbreviation } from '@/lib/league/myTeamEdit'

type SessionWithUser = { user?: { id?: string } } | null

/** GET: list managers/rosters. DELETE: remove manager. PATCH: assign user to roster (orphan adoption). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as SessionWithUser
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params

  const role = await getLeagueRole(leagueId, userId)
  if (role !== 'commissioner' && role !== 'co_commissioner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [leagueRow, teamRows, rosters] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: {
      name: true, platform: true, settings: true, leagueSize: true, leagueType: true, leagueVariant: true,
    } }),
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: {
        id: true,
        externalId: true,
        ownerName: true,
        teamName: true,
        avatarUrl: true,
        isCommissioner: true,
        isCoCommissioner: true,
        isOrphan: true,
        role: true,
        platformUserId: true,
        claimedByUserId: true,
        managerKind: true,
        lifecycleState: true,
      },
    }),
    prisma.roster.findMany({
      where: { leagueId },
      select: { id: true, platformUserId: true, managerUserId: true, settings: true, coOwners: {
        select: { userId: true, rosterOwnerKey: true, claimedOwnerId: true, acceptedAt: true },
      } },
    }),
  ])
  // Co-commissioners the tournament that created this league granted (no team needed). A team's own
  // flag only covers people holding a seat, so the list would otherwise show them as plain managers.
  const tournamentCoIds = new Set(teamlessCoCommissionerIds(leagueRow?.settings))
  const teams = teamRows.map(({ claimedByUserId, ...t }) => ({
    ...t,
    isCoCommissioner: t.isCoCommissioner || (!t.isCommissioner && Boolean(claimedByUserId) && tournamentCoIds.has(claimedByUserId as string)),
  }))
  const candidateUserIds = Array.from(
    new Set([
      ...rosters.map(rosterManagerKey).filter((id): id is string => Boolean(id)),
      ...rosters.flatMap(r => r.coOwners?.map(c => c.userId) ?? []),
      ...teamRows.flatMap(t => t.claimedByUserId ? [t.claimedByUserId] : []),
      ...tournamentCoIds,
    ]),
  )
  const appUsers = candidateUserIds.length
    ? await prisma.appUser.findMany({
        where: { id: { in: candidateUserIds } },
        select: { id: true, username: true, displayName: true },
      })
    : []
  const appUserById = new Map(appUsers.map((u) => [u.id, u]))
  const teamByExtId = new Map(teams.map((t) => [t.externalId, t]))
  const managers = rosters.map((r) => {
    const team = teamByExtId.get(r.platformUserId) ?? teamByExtId.get(r.id)
    const managerId = rosterManagerKey(r)
    const appUser = managerId ? appUserById.get(managerId) : null
    return {
      rosterId: r.id,
      userId: managerId,
      username: appUser?.username ?? null,
      displayName: team?.ownerName ?? appUser?.displayName ?? team?.teamName ?? r.platformUserId,
      leagueTeamId: team?.id ?? null,
      isCommissioner: team?.isCommissioner ?? false,
      isCoCommissioner: Boolean(team?.isCoCommissioner) || (!team?.isCommissioner && Boolean(managerId) && tournamentCoIds.has(managerId as string)),
      isOrphanTeam: team?.isOrphan ?? false,
      teamRole: team?.role ?? 'member',
    }
  })
  // Every tournament co-commissioner, seat or not, so a screen can list the people who run the league.
  const tournamentCoCommissioners = [...tournamentCoIds].map((id) => {
    const u = appUserById.get(id)
    return {
      userId: id,
      username: u?.username ?? null,
      displayName: u?.displayName ?? u?.username ?? null,
      hasTeam: rosters.some((r) => rosterManagerKey(r) === id),
    }
  })

  const native = Boolean(leagueRow && isNativePlatform(leagueRow.platform))
  const divisions = readDivisionConfig(leagueRow?.settings)
  const rosterById = new Map(rosters.map(r => [r.id, r]))
  const teamDirectory = teamRows.filter(t => t.lifecycleState !== 'ARCHIVED' && t.role !== 'viewer').map(team => {
    const roster = rosterById.get(team.externalId)
    const managerId = team.claimedByUserId ?? (roster ? rosterManagerKey(roster) : team.platformUserId)
    const manager = managerId ? appUserById.get(managerId) : null
    const occupied = Boolean(team.claimedByUserId || (!team.isOrphan &&
      (team.managerKind === 'HUMAN' || (managerId && (manager || !native)))))
    const divisionIndex = divisions.teamAssignments[team.id]
    return {
      id: team.id, externalId: team.externalId, name: team.teamName, avatarUrl: team.avatarUrl,
      rosterId: roster?.id ?? null, abbreviation: normalizeTeamAbbreviation((roster?.settings as Record<string, unknown> | null)?.teamAbbreviation) ?? '',
      status: team.managerKind === 'AI' && !team.isOrphan && !team.claimedByUserId ? 'automated' : occupied ? 'managed' : 'open',
      manager: occupied ? { id: manager?.id ?? managerId, username: manager?.username ?? null, name: manager?.displayName ?? team.ownerName } : null,
      role: team.isCommissioner ? 'Commissioner' : team.isCoCommissioner ? 'Co-commissioner' : null,
      division: divisionIndex == null ? null : divisions.names[divisionIndex]?.trim() || `Division ${divisionIndex + 1}`,
      coOwners: (roster?.coOwners ?? []).filter(c => c.rosterOwnerKey === roster?.platformUserId && c.claimedOwnerId === team.claimedByUserId)
        .map(c => ({ id: c.userId, accepted: Boolean(c.acceptedAt) })),
    }
  })
  return NextResponse.json({
    teams,
    rosters: rosters.map((r) => ({ id: r.id, platformUserId: r.platformUserId })),
    managers,
    tournamentCoCommissioners,
    directory: {
      leagueName: leagueRow?.name ?? '',
      capacity: leagueRow?.leagueSize ?? teamDirectory.length,
      native,
      canManage: native && (role === 'commissioner' || await canCommissionerAct(leagueId, userId, 'league')),
      isHeadCommissioner: role === 'commissioner',
      multiTeamSupported: Boolean(leagueRow && multiTeamManagersSupported(leagueRow)),
      allowMultiTeamManagers: readAllowMultiTeamManagers(leagueRow?.settings),
      allowManagerTeamNameEdits: managerTeamNameEditsAllowed(leagueRow?.settings),
      teams: teamDirectory,
    },
  })
}

/**
 * Releasing or reassigning a seat is league setup — except a commissioner's own seat (the owner's team, or a team
 * flagged commissioner or co-commissioner), which only the head commissioner may touch. Both handlers let ANY
 * co-commissioner through, including one limited to chat, and a co-commissioner could release the head commissioner's
 * team (2026-11-16).
 */
async function seatNeed(leagueId: string, rosterId: string): Promise<CommissionerNeed> {
  const [league, roster, team] = await Promise.all([
    prisma.league.findFirst({ where: { id: leagueId }, select: { userId: true } }),
    prisma.roster.findFirst({ where: { id: rosterId, leagueId }, select: { platformUserId: true, managerUserId: true } }),
    prisma.leagueTeam.findFirst({ where: { leagueId, externalId: rosterId }, select: { isCommissioner: true, isCoCommissioner: true } }),
  ])
  const ownersSeat = Boolean(league?.userId && roster && rosterManagerKey(roster) === league.userId)
  return ownersSeat || team?.isCommissioner || team?.isCoCommissioner ? 'head' : 'league'
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as SessionWithUser
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params

  const rosterId = req.nextUrl.searchParams?.get('rosterId') ?? (await req.json().catch(() => ({}))).rosterId
  if (!rosterId) return NextResponse.json({ error: 'rosterId required' }, { status: 400 })
  const refused = await commissionerAccessResponse(leagueId, userId, await seatNeed(leagueId, rosterId))
  if (refused) return refused

  // Releases every record of the seat — roster, team, entry slot, membership, season roster.
  // Renaming the roster's owner alone left the removed manager's team claim, membership and
  // season ownership in place, so they kept access to and control of the team.
  const released = await prisma.$transaction((tx) => releaseLeagueSeat(tx, { leagueId, rosterId }))
  if (!released.ok) {
    return NextResponse.json({ error: 'Roster not found or does not belong to this league' }, { status: 404 })
  }

  return NextResponse.json({
    status: 'ok',
    message: 'Manager removed; the team is open for the next person who joins.',
    rosterId,
  })
}

/** PATCH: assign a user to a roster (e.g. adopt orphan team). Body: { rosterId, userId }. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as SessionWithUser
  const commissionerId = session?.user?.id
  if (!commissionerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await params
  const body = await req.json().catch(() => ({}))
  const rosterId = body?.rosterId ?? null
  let userId = typeof body?.userId === 'string' ? body.userId : null
  const username = typeof body?.username === 'string' ? body.username.trim().replace(/^@/, '') : ''
  if (!rosterId || (!userId && !username)) {
    return NextResponse.json({ error: 'Choose a team and enter an AllFantasy username.' }, { status: 400 })
  }
  const refused = await commissionerAccessResponse(leagueId, commissionerId, await seatNeed(leagueId, String(rosterId)))
  if (refused) return refused
  if (!userId) {
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true } })
    if (!league || !isNativePlatform(league.platform)) return NextResponse.json({ error: 'This team is managed on its source platform.' }, { status: 409 })
    const users = await prisma.appUser.findMany({
      where: { username: { equals: username, mode: 'insensitive' } }, select: { id: true }, take: 2,
    })
    if (users.length !== 1) return NextResponse.json({ error: 'Enter an exact AllFantasy username.' }, { status: 404 })
    userId = users[0].id
  }
  const targetUserId = userId

  const roster = await prisma.roster.findFirst({
    where: { id: rosterId, leagueId },
    select: { id: true, platformUserId: true },
  })
  if (!roster) {
    return NextResponse.json({ error: 'Roster not found or does not belong to this league' }, { status: 404 })
  }

  const wasOrphan = isOrphanPlatformUserId(roster.platformUserId)

  // The seat writer, with `replaceExisting` so a commissioner can hand a held team to someone
  // else. Setting only the roster owner left the new manager unable to reach their own roster
  // through the redraft routes (which check the team claim) after the draft.
  const seat = await prisma.$transaction((tx) =>
    assignLeagueSeat(tx, { leagueId, rosterId, userId: targetUserId, replaceExisting: true }),
  )
  if (!seat.ok) {
    const status = seat.code === 'ROSTER_NOT_FOUND' || seat.code === 'USER_NOT_FOUND' ? 404 : 409
    return NextResponse.json({ error: seat.message, code: seat.code }, { status })
  }

  // The team has a real manager now: if Chimmy was running it, Chimmy steps off at once (not at the
  // next hourly sweep), and the commissioner who handed it to Chimmy is told.
  const leagueName = (await prisma.league.findUnique({ where: { id: leagueId }, select: { name: true } }))?.name ?? null
  await endManagedForNewOwners(leagueId, commissionerId, leagueName).catch((error) => {
    console.warn('[commissioner managers] Chimmy hand-back failed; the hourly sweep will retry', error instanceof Error ? error.message : error)
  })

  if (wasOrphan) {
    await trackDiscoveryOrphanAdoption(
      { leagueId, rosterId, userId },
      { commissionerId, source: 'managers_route' }
    )
  }

  return NextResponse.json({ status: 'ok', rosterId, userId })
}
