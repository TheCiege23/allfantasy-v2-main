import * as prismaJson from '@/lib/prisma-json'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notifyUserPlatform } from '@/lib/tournament/tournamentMiniCommissionerNotifications'

export const dynamic = 'force-dynamic'

/**
 * GET: List setting change requests (main commissioner — approval center).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tournamentId } = await params
  const t = await prisma.legacyTournament.findUnique({
    where: { id: tournamentId },
    select: { creatorId: true },
  })
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (t.creatorId !== userId) {
    return NextResponse.json({ error: 'Only the tournament commissioner can view requests' }, { status: 403 })
  }

  const rows = await prisma.legacyTournamentLeagueSettingRequest.findMany({
    where: { tournamentId },
    orderBy: { createdAt: 'desc' },
    take: 80,
    include: {
      requester: { select: { id: true, username: true, displayName: true } },
      league: { select: { id: true, name: true } },
    },
  })

  return NextResponse.json({
    requests: rows.map((r) => ({
      id: r.id,
      tournamentId: r.tournamentId,
      leagueId: r.leagueId,
      leagueName: r.league?.name ?? r.leagueId,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      proposedPatch: r.proposedPatch as Record<string, unknown>,
      requester: {
        id: r.requester.id,
        username: r.requester.username,
        displayName: r.requester.displayName?.trim() || r.requester.username || r.requesterId,
      },
    })),
  })
}

/**
 * Mini-commissioner proposes a patch to `League.settings` (main commissioner must approve).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tournamentId } = await params
  const t = await prisma.legacyTournament.findUnique({
    where: { id: tournamentId },
    select: { creatorId: true },
  })
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: { leagueId?: string; proposedPatch?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const leagueId = body.leagueId?.trim()
  const proposedPatch = body.proposedPatch
  if (!leagueId || !proposedPatch || typeof proposedPatch !== 'object') {
    return NextResponse.json({ error: 'leagueId and proposedPatch object required' }, { status: 400 })
  }

  const link = await prisma.legacyTournamentLeague.findFirst({
    where: { tournamentId, leagueId },
    select: { id: true },
  })
  if (!link) {
    return NextResponse.json({ error: 'League is not part of this tournament' }, { status: 400 })
  }

  if (t.creatorId === userId) {
    return NextResponse.json(
      { error: 'Main commissioner can edit league settings directly; approval flow is for mini-commissioners.' },
      { status: 400 }
    )
  }

  const mini = await prisma.legacyTournamentMiniCommissioner.findFirst({
    where: { tournamentId, leagueId, userId },
  })
  if (!mini) {
    return NextResponse.json({ error: 'Only the assigned mini-commissioner for this league may propose changes' }, { status: 403 })
  }

  const row = await prisma.legacyTournamentLeagueSettingRequest.create({
    data: {
      tournamentId,
      leagueId,
      requesterId: userId,
      proposedPatch: prismaJson.toPrismaJsonInput(proposedPatch),
      status: 'pending',
    },
  })

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { name: true } })
  await notifyUserPlatform(
    t.creatorId,
    'tournament_league_setting_request',
    'League settings change requested',
    `${league?.name ?? 'A league'} — review and approve or reject.`,
    { requestId: row.id, tournamentId, leagueId }
  )

  return NextResponse.json({ request: row })
}
