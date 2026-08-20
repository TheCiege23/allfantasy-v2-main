import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET: list unclaimed placeholder rosters in this imported league, for the
 * join-flow fallback when auto-matching failed. Only accessible to league
 * members who don't yet hold a roster.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params

  // Check membership and bail out if user already has a roster.
  const myRoster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { id: true },
  })
  if (myRoster) {
    return NextResponse.json({ ok: true, alreadyClaimed: true, rosters: [] })
  }

  const allRosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true, platformUserId: true, playerData: true },
  })
  const platformIds = allRosters.map((r) => r.platformUserId)
  const realUsers = await prisma.appUser.findMany({
    where: { id: { in: platformIds } },
    select: { id: true },
  })
  const realUserIds = new Set(realUsers.map((u) => u.id))
  const placeholders = allRosters.filter((r) => !realUserIds.has(r.platformUserId))

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId, externalId: { in: placeholders.map((r) => r.id) } },
    select: { externalId: true, ownerName: true, teamName: true, avatarUrl: true },
  })
  const byRoster = new Map(teams.map((t) => [t.externalId, t] as const))

  const rosters = placeholders.map((r) => {
    const meta = ((r.playerData as Record<string, unknown> | null)?.import as
      | Record<string, unknown>
      | undefined) ?? null
    const team = byRoster.get(r.id)
    return {
      rosterId: r.id,
      ownerName: team?.ownerName ?? (meta?.ownerName as string | undefined) ?? null,
      teamName: team?.teamName ?? (meta?.teamName as string | undefined) ?? null,
      avatarUrl: team?.avatarUrl ?? (meta?.avatarUrl as string | undefined) ?? null,
      provider: (meta?.provider as string | undefined) ?? null,
    }
  })

  return NextResponse.json({ ok: true, alreadyClaimed: false, rosters })
}

/**
 * POST: claim a specific placeholder roster by id. Caller must be a
 * league member without a roster already; the target roster must be a
 * placeholder (platformUserId not resolving to an AppUser).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params

  const body = (await req.json().catch(() => null)) as { rosterId?: string } | null
  const rosterId = typeof body?.rosterId === 'string' ? body.rosterId : ''
  if (!rosterId) return NextResponse.json({ error: 'rosterId is required' }, { status: 400 })

  return prisma.$transaction(async (tx) => {
    const existing = await tx.roster.findFirst({
      where: { leagueId, platformUserId: userId },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json(
        { error: 'You already hold a roster in this league.', code: 'ALREADY_CLAIMED' },
        { status: 409 },
      )
    }
    const target = await tx.roster.findFirst({
      where: { id: rosterId, leagueId },
      select: { id: true, platformUserId: true },
    })
    if (!target) {
      return NextResponse.json({ error: 'Roster not found in this league.' }, { status: 404 })
    }
    const owner = await tx.appUser.findUnique({
      where: { id: target.platformUserId },
      select: { id: true },
    })
    if (owner) {
      return NextResponse.json(
        { error: 'That roster is already claimed.', code: 'ROSTER_TAKEN' },
        { status: 409 },
      )
    }
    await tx.roster.update({ where: { id: target.id }, data: { platformUserId: userId } })
    return NextResponse.json({ ok: true, rosterId: target.id })
  })
}
