import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { getServedOrigin } from '@/lib/http/served-origin'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getInviteClaimEligibility, resolveLinkedPlatformUserIds } from '@/lib/league-invite/claimIdentity'
import { getZombieJoinPreview } from '@/lib/zombie/zombieJoinPreview'

const createInviteSchema = z.object({
  leagueId: z.string().min(1),
})

function isInviteExpired(expiresAt: Date | null) {
  return Boolean(expiresAt && expiresAt.getTime() < Date.now())
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const json = await req.json().catch(() => null)
  const parsed = createInviteSchema.safeParse(json)

  if (!parsed.success) {
    return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  }

  const { leagueId } = parsed.data

  const leagueTeam = await prisma.leagueTeam.findFirst({
    where: {
      leagueId,
      claimedByUserId: userId,
      role: { in: ['commissioner', 'co_commissioner'] },
    },
  })

  if (!leagueTeam) {
    return NextResponse.json({ error: 'Only commissioners can create invite links' }, { status: 403 })
  }

  const existingInvite = await prisma.leagueInvite.findFirst({
    where: {
      leagueId,
      isActive: true,
      createdBy: userId,
    },
    orderBy: { createdAt: 'desc' },
  })

  const baseUrl = process.env.NEXTAUTH_URL?.trim() || getServedOrigin(req)

  if (existingInvite && !isInviteExpired(existingInvite.expiresAt) && existingInvite.useCount < existingInvite.maxUses) {
    return NextResponse.json({
      token: existingInvite.token,
      inviteUrl: `${baseUrl}/join/${existingInvite.token}`,
    })
  }

  const invite = await prisma.leagueInvite.create({
    data: {
      leagueId,
      createdBy: userId,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  })

  return NextResponse.json({
    token: invite.token,
    inviteUrl: `${baseUrl}/join/${invite.token}`,
  })
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams?.get('token')?.trim()
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id ?? null

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  const invite = await prisma.leagueInvite.findFirst({
    where: { token, isActive: true },
    include: {
      league: {
        include: {
          teams: {
            orderBy: { externalId: 'asc' },
          },
        },
      },
    },
  })

  if (!invite || isInviteExpired(invite.expiresAt) || invite.useCount >= invite.maxUses) {
    return NextResponse.json({ error: 'Invite not found or expired' }, { status: 404 })
  }

  const [linkedPlatformUserIds, zombie] = await Promise.all([
    userId
      ? resolveLinkedPlatformUserIds({ userId, platform: invite.league.platform })
      : Promise.resolve(new Set<string>()),
    // A Zombie league's invite shows its hero and how-it-works; a failure here must not break the join.
    getZombieJoinPreview(invite.leagueId).catch(() => null),
  ])

  return NextResponse.json({
    leagueId: invite.leagueId,
    leagueName: invite.league.name,
    sport: invite.league.sport,
    teamCount: invite.league.leagueSize,
    zombie,
    teams: invite.league.teams.map((team) => ({
      id: team.id,
      externalId: team.externalId,
      teamName: team.teamName,
      ownerName: team.ownerName,
      avatarUrl: team.avatarUrl,
      role: team.role,
      isOrphan: team.isOrphan,
      isClaimed: !!team.claimedByUserId,
      claimEligibility: getInviteClaimEligibility({
        linkedPlatformUserIds,
        platformUserId: team.platformUserId,
        isClaimed: Boolean(team.claimedByUserId),
        isOrphan: team.isOrphan,
      }),
    })),
  })
}

