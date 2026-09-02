import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getServedOrigin } from '@/lib/http/served-origin'
import { prisma } from '@/lib/prisma'
import { getLeagueDrafts } from '@/lib/sleeper-client'

type SleeperDraftSummary = {
  start_time?: number | null
  status?: string | null
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function getDraftPosition(settings: Record<string, unknown> | null, externalId: string) {
  const candidates = [
    settings?.draftOrder,
    settings?.draft_order,
    toRecord(settings?.metadata)?.draft_order,
  ]

  for (const candidate of candidates) {
    const order = toRecord(candidate)
    if (!order) continue
    const value = order[externalId]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }

  return null
}

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  }

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    include: {
      teams: {
        orderBy: { externalId: 'asc' },
      },
      invites: {
        where: { isActive: true, createdBy: userId },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })

  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }

  const userTeam = league.teams.find((team) => team.claimedByUserId === userId) ?? null
  const isOwner = league.userId === userId
  if (!userTeam && !isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let draftDate: string | null = null
  let draftStatus: string | null = null

  if (league.platform === 'sleeper' && league.platformLeagueId) {
    const drafts = (await getLeagueDrafts(league.platformLeagueId).catch(() => [])) as SleeperDraftSummary[]
    const draft = drafts[0] ?? null
    if (draft?.start_time && Number.isFinite(draft.start_time)) {
      draftDate = new Date(draft.start_time).toISOString()
    }
    if (typeof draft?.status === 'string') {
      draftStatus = draft.status
    }
  }

  const settings = toRecord(league.settings)
  const baseUrl = process.env.NEXTAUTH_URL?.trim() || getServedOrigin(req)
  const inviteToken = league.invites[0]?.token ?? null
  const inviteUrl = inviteToken ? `${baseUrl}/join/${inviteToken}` : null
  const userRole = userTeam?.role ?? (isOwner ? 'commissioner' : 'member')

  return NextResponse.json({
    id: league.id,
    name: league.name ?? 'League',
    sport: league.sport,
    platform: league.platform,
    format: league.leagueVariant ?? (league.isDynasty ? 'dynasty' : 'redraft'),
    scoring: league.scoring ?? 'Standard',
    teamCount: league.leagueSize ?? league.teams.length,
    season: league.season,
    isDynasty: league.isDynasty,
    settings,
    userRole,
    inviteToken,
    inviteUrl,
    draftDate,
    draftStatus,
    teams: league.teams.map((team) => ({
      id: team.id,
      externalId: team.externalId,
      teamName: team.teamName,
      ownerName: team.ownerName,
      avatarUrl: team.avatarUrl,
      platformUserId: team.platformUserId ?? null,
      role: team.role,
      isOrphan: team.isOrphan,
      claimedByUserId: team.claimedByUserId,
      draftPosition: getDraftPosition(settings, team.externalId),
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      pointsFor: team.pointsFor,
      pointsAgainst: team.pointsAgainst,
      currentRank: team.currentRank ?? null,
      faabRemaining: null,
      waiverPriority: null,
      divisionId: team.divisionId ?? null,
    })),
  })
}

