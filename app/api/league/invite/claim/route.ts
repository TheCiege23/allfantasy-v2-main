import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getInviteClaimEligibility, resolveLinkedPlatformUserIds } from '@/lib/league-invite/claimIdentity'
import { assignLeagueSeat } from '@/lib/league/leagueSeats'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { assertPaidJoinAllowed, linkDuesToRoster } from '@/lib/league-finance/joinGate'
import { findExistingLeagueClaim } from '@/lib/identity/linkedAccounts'

const claimSchema = z.object({
  token: z.string().min(1),
  teamExternalId: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const json = await req.json().catch(() => null)
  const parsed = claimSchema.safeParse(json)

  if (!parsed.success) {
    return NextResponse.json({ error: 'token and teamExternalId are required' }, { status: 400 })
  }

  const { token, teamExternalId } = parsed.data

  const invite = await prisma.leagueInvite.findFirst({
    where: { token, isActive: true },
    include: {
      league: {
        select: {
          id: true,
          platform: true,
        },
      },
    },
  })

  if (!invite) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  }

  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: 'Invite expired' }, { status: 410 })
  }

  if (invite.useCount >= invite.maxUses) {
    return NextResponse.json({ error: 'Invite expired' }, { status: 410 })
  }

  const team = await prisma.leagueTeam.findFirst({
    where: {
      leagueId: invite.leagueId,
      externalId: teamExternalId,
    },
  })

  if (!team) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  }

  if (team.claimedByUserId) {
    return NextResponse.json({ error: 'Team already claimed' }, { status: 409 })
  }

  const linkedPlatformUserIds = await resolveLinkedPlatformUserIds({
    userId,
    platform: invite.league.platform,
  })
  const eligibility = getInviteClaimEligibility({
    linkedPlatformUserIds,
    platformUserId: team.platformUserId,
    isClaimed: Boolean(team.claimedByUserId),
    isOrphan: team.isOrphan,
  })
  if (eligibility === 'locked') {
    return NextResponse.json(
      { error: 'This imported team belongs to a different linked manager account.' },
      { status: 403 }
    )
  }

  const existingClaim = await prisma.leagueManagerClaim.findFirst({
    where: {
      leagueId: invite.leagueId,
      afUserId: userId,
    },
  })

  if (existingClaim) {
    return NextResponse.json({ error: 'You already have a team in this league' }, { status: 409 })
  }

  const heldRoster = await prisma.roster.findFirst({
    where: { leagueId: invite.leagueId, platformUserId: userId },
    select: { id: true },
  })
  if (heldRoster) {
    return NextResponse.json({ error: 'You already have a team in this league' }, { status: 409 })
  }

  /*
   * 🛑 THE SAME SEAT GATES AS POST /api/leagues/join — this route used to apply neither.
   *
   * It is not only a personal-invite path. Canonical create and the commissioner invite route store
   * the league's PUBLIC join code as a `LeagueInvite.token`, so anyone holding `/join?code=` (posted
   * on discovery cards and by /api/discover/orphans) can present it here. Before 2026-10-01 that took
   * a seat in a paid league without dues, and gave a second seat to a person through another of their
   * accounts — the two refusals POST /api/leagues/join makes. Same functions, not copies.
   */
  const priorClaim = await findExistingLeagueClaim({ userId, leagueId: invite.leagueId })
  if (priorClaim?.viaOtherAccount) {
    return NextResponse.json(
      {
        error:
          'One of your other AllFantasy accounts already has a team in this league. Sign in with that account to manage it — a league can only be joined once per person.',
        code: 'DUPLICATE_LEAGUE_CLAIM',
      },
      { status: 409 },
    )
  }
  const refusePayment = (gate: { code: string; message: string }) =>
    NextResponse.json(
      { error: gate.message, code: gate.code },
      { status: gate.code === 'LEAGUE_NOT_FOUND' ? 404 : 402 },
    )

  const nextUseCount = invite.useCount + 1

  /**
   * A team in a league created on AllFantasy is keyed by its roster id (`LeagueTeam.externalId`),
   * not by an imported `sourceTeamId`, so the import match below never found it: the claim set
   * `claimedByUserId` and left the roster owned by its `open-slot-` placeholder — the manager
   * could see the draft and never pick. The seat writer takes every table together.
   */
  if (isNativePlatform(invite.league.platform)) {
    const result = await prisma.$transaction(async (tx) => {
      // Inside the seat transaction, as the join route checks it.
      const paid = await assertPaidJoinAllowed({ leagueId: invite.leagueId, userId, tx })
      if (!paid.ok) return { ok: false as const, code: paid.code, message: paid.message, payment: true as const }
      const seat = await assignLeagueSeat(tx, { leagueId: invite.leagueId, rosterId: teamExternalId, userId })
      if (!seat.ok) return seat
      await linkDuesToRoster({ leagueId: invite.leagueId, userId, rosterId: seat.rosterId, tx })
      await tx.leagueManagerClaim.create({
        data: {
          leagueId: invite.leagueId,
          afUserId: userId,
          teamExternalId,
          platformUserId: userId,
          isConfirmed: true,
        },
      })
      await tx.leagueInvite.update({
        where: { id: invite.id },
        data: { useCount: { increment: 1 }, isActive: nextUseCount < invite.maxUses },
      })
      return seat
    })
    if (!result.ok) {
      if ('payment' in result) return refusePayment(result)
      const status = result.code === 'ROSTER_NOT_FOUND' ? 404 : 409
      return NextResponse.json({ error: result.message }, { status })
    }
    return NextResponse.json({ ok: true, leagueId: invite.leagueId })
  }

  const paid = await assertPaidJoinAllowed({ leagueId: invite.leagueId, userId })
  if (!paid.ok) return refusePayment(paid)

  const rosters = await prisma.roster.findMany({
    where: { leagueId: invite.leagueId },
    select: { id: true, platformUserId: true, playerData: true },
  })
  const rosterToClaim = rosters.find((roster) => {
    const playerData = roster.playerData as Record<string, unknown> | null
    const importData =
      playerData && typeof playerData.import === 'object' && playerData.import
        ? (playerData.import as Record<string, unknown>)
        : null
    const sourceTeamId = typeof importData?.sourceTeamId === 'string' ? importData.sourceTeamId.trim() : ''
    return sourceTeamId === teamExternalId
  })

  await prisma.$transaction([
    prisma.leagueTeam.update({
      where: { id: team.id },
      data: {
        claimedByUserId: userId,
        isOrphan: false,
      },
    }),
    ...(rosterToClaim
      ? [
          prisma.roster.update({
            where: { id: rosterToClaim.id },
            data: {
              platformUserId: userId,
              playerData: {
                ...((rosterToClaim.playerData as Record<string, unknown> | null) ?? {}),
                import: {
                  ...((((rosterToClaim.playerData as Record<string, unknown> | null)?.import as Record<string, unknown> | null) ?? {})),
                  afUserId: userId,
                  claimedAt: new Date().toISOString(),
                },
              },
            },
          }),
        ]
      : []),
    prisma.leagueManagerClaim.create({
      data: {
        leagueId: invite.leagueId,
        afUserId: userId,
        teamExternalId,
        platformUserId: team.platformUserId,
        isConfirmed: true,
      },
    }),
    prisma.redraftLeagueMember.upsert({
      where: { leagueId_userId: { leagueId: invite.leagueId, userId } },
      create: { leagueId: invite.leagueId, userId, role: 'MEMBER' },
      update: {},
    }),
    prisma.leagueInvite.update({
      where: { id: invite.id },
      data: {
        useCount: { increment: 1 },
        isActive: nextUseCount < invite.maxUses,
      },
    }),
  ])
  if (rosterToClaim) await linkDuesToRoster({ leagueId: invite.leagueId, userId, rosterId: rosterToClaim.id })

  return NextResponse.json({ ok: true, leagueId: invite.leagueId })
}
