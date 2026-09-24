import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'
import { isOrphanPlatformUserId } from '@/lib/orphan-ai-manager/orphanRosterResolver'
import { trackDiscoveryOrphanAdoption } from '@/lib/discovery-analytics/server'
import { assignLeagueSeat, releaseLeagueSeat } from '@/lib/league/leagueSeats'

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

  const [teams, rosters] = await Promise.all([
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
      },
    }),
    prisma.roster.findMany({
      where: { leagueId },
      select: { id: true, platformUserId: true },
    }),
  ])
  const candidateUserIds = Array.from(
    new Set(rosters.map((r) => r.platformUserId).filter((id): id is string => Boolean(id))),
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
    const appUser = r.platformUserId ? appUserById.get(r.platformUserId) : null
    return {
      rosterId: r.id,
      userId: r.platformUserId,
      username: appUser?.username ?? null,
      displayName: team?.ownerName ?? appUser?.displayName ?? team?.teamName ?? r.platformUserId,
      leagueTeamId: team?.id ?? null,
      isCommissioner: team?.isCommissioner ?? false,
      isCoCommissioner: team?.isCoCommissioner ?? false,
      isOrphanTeam: team?.isOrphan ?? false,
      teamRole: team?.role ?? 'member',
    }
  })

  return NextResponse.json({
    teams,
    rosters: rosters.map((r) => ({ id: r.id, platformUserId: r.platformUserId })),
    managers,
  })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as SessionWithUser
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params

  const delRole = await getLeagueRole(leagueId, userId)
  if (delRole !== 'commissioner' && delRole !== 'co_commissioner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rosterId = req.nextUrl.searchParams?.get('rosterId') ?? (await req.json().catch(() => ({}))).rosterId
  if (!rosterId) return NextResponse.json({ error: 'rosterId required' }, { status: 400 })

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
  const patchRole = await getLeagueRole(leagueId, commissionerId)
  if (patchRole !== 'commissioner' && patchRole !== 'co_commissioner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const rosterId = body?.rosterId ?? null
  const userId = body?.userId ?? null
  if (!rosterId || !userId) {
    return NextResponse.json({ error: 'rosterId and userId required' }, { status: 400 })
  }

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
    assignLeagueSeat(tx, { leagueId, rosterId, userId, replaceExisting: true }),
  )
  if (!seat.ok) {
    const status = seat.code === 'ROSTER_NOT_FOUND' || seat.code === 'USER_NOT_FOUND' ? 404 : 409
    return NextResponse.json({ error: seat.message, code: seat.code }, { status })
  }

  if (wasOrphan) {
    await trackDiscoveryOrphanAdoption(
      { leagueId, rosterId, userId },
      { commissionerId, source: 'managers_route' }
    )
  }

  return NextResponse.json({ status: 'ok', rosterId, userId })
}
