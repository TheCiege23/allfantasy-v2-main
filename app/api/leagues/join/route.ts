/**
 * POST /api/leagues/join — Join a league by invite code (and optional password).
 * Body: { code: string, password?: string }
 * Creates a Roster for the user if not already a member.
 */

import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { validateFantasyInviteCode } from '@/lib/league-invite'
import { resolveJoinRankGate } from '@/lib/league-join/resolveJoinRankGate'
import { prisma } from '@/lib/prisma'
import { assertPaidJoinAllowed, linkDuesToRoster } from '@/lib/league-finance/joinGate'
import { claimPlaceholderRoster } from '@/lib/league-import/placeholderClaim'
import { findExistingLeagueClaim } from '@/lib/identity/linkedAccounts'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Sign in to join a league' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const code = typeof body.code === 'string' ? body.code.trim() : null
  const password = typeof body.password === 'string' ? body.password : undefined

  if (!code) return NextResponse.json({ error: 'Missing invite code' }, { status: 400 })

  const validation = await validateFantasyInviteCode(code, { password, userId })
  if (!validation.valid) {
    if (validation.error === 'ALREADY_MEMBER' && validation.preview?.leagueId) {
      return NextResponse.json({
        success: true,
        leagueId: validation.preview.leagueId,
        alreadyMember: true,
      })
    }
    const statusByError: Record<string, number> = {
      INVALID_CODE: 404,
      EXPIRED: 410,
      LEAGUE_FULL: 409,
      PASSWORD_REQUIRED: 400,
      INCORRECT_PASSWORD: 400,
      INVITE_DISABLED: 403,
      ALREADY_MEMBER: 409,
    }
    const messageByError: Record<string, string> = {
      INVALID_CODE: 'Invalid invite code',
      EXPIRED: 'Invite expired',
      LEAGUE_FULL: 'League is full',
      PASSWORD_REQUIRED: 'League password is required',
      INCORRECT_PASSWORD: 'Incorrect password',
      INVITE_DISABLED: 'Invite link is disabled',
      ALREADY_MEMBER: 'You are already in this league',
    }
    return NextResponse.json(
      { error: messageByError[validation.error] ?? 'Failed to validate invite' },
      { status: statusByError[validation.error] ?? 400 }
    )
  }
  const result = validation.preview

  const rankGate = await resolveJoinRankGate({
    leagueId: result.leagueId,
    inviteTokenOrCode: code,
    userId,
  })

  if (!rankGate.allowed) {
    const minRankLevel = rankGate.minRankLevel ?? 1
    const maxRankLevel = rankGate.maxRankLevel ?? 1
    return NextResponse.json(
      {
        error: 'RANK_GATE_BLOCKED',
        message: `This league is open to users ranked Level ${minRankLevel} through Level ${maxRankLevel}. Ask the commissioner for a special invite.`,
        minRankLevel,
        maxRankLevel,
        userRankLevel: rankGate.userRankLevel,
      },
      { status: 403 }
    )
  }

  const joinResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.roster.findUnique({
      where: { leagueId_platformUserId: { leagueId: result.leagueId, platformUserId: userId } },
      select: { id: true },
    })
    if (existing) {
      return { success: true as const, leagueId: result.leagueId, alreadyMember: true as const }
    }

    // DUPLICATE-ACCOUNT GATE. The `leagueId_platformUserId` lookup above only catches this
    // same AppUser rejoining. One human holding several AF accounts (three sign-in methods
    // on three different emails are indistinguishable from three people) would otherwise
    // take a second team in the same league under the other account.
    //
    // The only trustworthy link between those accounts is a shared platform identity — the
    // same Sleeper account cannot belong to two humans. This is evidence-based, so it can
    // only refuse when we HAVE evidence: a user who never imported has no identity to match
    // on and is let through, which is a real coverage limit, not an oversight.
    const priorClaim = await findExistingLeagueClaim(
      { userId, leagueId: result.leagueId },
      tx,
    )
    if (priorClaim?.viaOtherAccount) {
      return {
        success: false as const,
        status: 409,
        error:
          'One of your other AllFantasy accounts already has a team in this league. Sign in with that account to manage it — a league can only be joined once per person.',
        code: 'DUPLICATE_LEAGUE_CLAIM' as const,
      }
    }

    const [league, leagueRosters, draftSession, profile] = await Promise.all([
      tx.league.findUnique({
        where: { id: result.leagueId },
        select: {
          id: true,
          name: true,
          platform: true,
          leagueSize: true,
          leagueVariant: true,
        },
      }),
      tx.roster.findMany({
        where: { leagueId: result.leagueId },
        select: { platformUserId: true },
      }),
      tx.draftSession.findUnique({
        where: { leagueId: result.leagueId },
        select: { status: true },
      }),
      tx.userProfile.findFirst({
        where: { userId },
        select: { displayName: true, sleeperUsername: true },
      }),
    ])

    if (!league) {
      return { success: false as const, status: 404, error: 'League not found' }
    }

    const realRosterUsers = await tx.appUser.findMany({
      where: { id: { in: leagueRosters.map((r: { platformUserId: string }) => r.platformUserId) } },
      select: { id: true },
    })
    const claimedRosterCount = realRosterUsers.length

    if (league.leagueSize != null && claimedRosterCount >= league.leagueSize) {
      return { success: false as const, status: 409, error: 'League is full' }
    }

    if (league.leagueVariant === 'survivor' && draftSession?.status && draftSession.status !== 'pre_draft') {
      return {
        success: false as const,
        status: 409,
        error: 'Survivor leagues lock new joins after the draft starts.',
      }
    }

    const paidGate = await assertPaidJoinAllowed({ leagueId: result.leagueId, userId, tx: tx as Prisma.TransactionClient })
    if (!paidGate.ok) {
      const st = paidGate.code === 'LEAGUE_NOT_FOUND' ? 404 : 402
      return { success: false as const, status: st, error: paidGate.message }
    }

    // Any imported league ships with placeholder rosters whose
    // platformUserId is the source manager id or "import:<provider>:<id>".
    // Try to claim the one matching this user's profile before creating a
    // fresh empty roster.
    const userEmail = await tx.appUser
      .findUnique({ where: { id: userId }, select: { email: true } })
      .then((u: { email: string | null } | null) => u?.email ?? null)
    const claim = await claimPlaceholderRoster({
      tx: tx as Prisma.TransactionClient,
      leagueId: result.leagueId,
      candidate: {
        appUserId: userId,
        displayName: profile?.displayName ?? null,
        sleeperUsername: profile?.sleeperUsername ?? null,
        email: userEmail,
      },
    })

    // If auto-match failed but there ARE unclaimed placeholders in this
    // league, skip fresh-roster creation and let the UI take the user to
    // the manual picker at /api/leagues/{id}/claim-roster.
    let claimPrompt = false
    if (!claim.claimed) {
      const unclaimedCount = await tx.roster.count({
        where: {
          leagueId: result.leagueId,
          platformUserId: { not: userId },
          NOT: {
            platformUserId: {
              in: (
                await tx.appUser.findMany({
                  where: {
                    id: {
                      in: (
                        await tx.roster.findMany({
                          where: { leagueId: result.leagueId },
                          select: { platformUserId: true },
                        })
                      ).map((r: { platformUserId: string }) => r.platformUserId),
                    },
                  },
                  select: { id: true },
                })
              ).map((u: { id: string }) => u.id),
            },
          },
        },
      })
      if (unclaimedCount > 0) claimPrompt = true
    }

    const roster = claim.claimed && claim.rosterId
      ? await tx.roster.findUnique({ where: { id: claim.rosterId }, select: { id: true } })
      : claimPrompt
        ? null
        : await tx.roster.create({
            data: {
              leagueId: result.leagueId,
              platformUserId: userId,
              playerData: { draftPicks: [] },
            },
            select: { id: true },
          })
    if (!roster && !claimPrompt) {
      return { success: false as const, status: 500, error: 'Failed to create roster' }
    }

    // Skip roster-linked setup when we deferred creation for manual claim;
    // those steps run after the user picks their team via /claim-roster.
    if (!roster) {
      return {
        success: true as const,
        leagueId: result.leagueId,
        alreadyMember: false as const,
        claimPrompt: true,
      }
    }

    await linkDuesToRoster({
      leagueId: result.leagueId,
      userId,
      rosterId: roster.id,
      tx: tx as Prisma.TransactionClient,
    })

    let teamNumber: number | null = null
    const slotForRoster = await tx.leagueEntrySlot.findFirst({
      where: { leagueId: result.leagueId, rosterId: roster.id },
      select: { id: true, slotNumber: true, status: true },
    })
    if (slotForRoster) {
      teamNumber = slotForRoster.slotNumber
      if (slotForRoster.status === 'OPEN') {
        await tx.leagueEntrySlot.update({
          where: { id: slotForRoster.id },
          data: { status: 'FILLED' },
        })
      }
    } else {
      const firstOpenSlot = await tx.leagueEntrySlot.findFirst({
        where: { leagueId: result.leagueId, rosterId: null, status: 'OPEN' },
        orderBy: { slotNumber: 'asc' },
        select: { id: true, slotNumber: true },
      })
      if (firstOpenSlot) {
        teamNumber = firstOpenSlot.slotNumber
        await tx.leagueEntrySlot.update({
          where: { id: firstOpenSlot.id },
          data: { rosterId: roster.id, status: 'FILLED' },
        })
      }
    }

    await tx.redraftLeagueMember
      .create({
        data: {
          leagueId: result.leagueId,
          userId,
          role: 'MEMBER',
          teamNumber,
        },
      })
      .catch(() => null)

    if (league.platform === 'manual') {
      const manualTeamCount = await tx.leagueTeam.count({
        where: { leagueId: result.leagueId },
      })
      if (league.leagueSize == null || manualTeamCount < league.leagueSize) {
        const displayName = profile?.displayName?.trim() || profile?.sleeperUsername?.trim() || 'Manager'
        const teamBaseName = league.name?.trim() || 'League'
        await tx.leagueTeam.create({
          data: {
            leagueId: result.leagueId,
            externalId: roster.id,
            ownerName: displayName,
            teamName: `${displayName}'s ${teamBaseName} Team`,
          },
        }).catch(() => null)
      }
    }

    return {
      success: true as const,
      leagueId: result.leagueId,
      alreadyMember: false as const,
    }
  })

  if (!joinResult.success) {
    // An explicit code from the branch wins: the duplicate-account refusal needs its own
    // code so the client can offer "sign in with your other account" instead of rendering
    // a generic failure. Status-derived codes stay as the fallback for the older branches.
    const explicitCode = (joinResult as { code?: string }).code
    const code =
      explicitCode ??
      (joinResult.status === 402 ? 'PAYMENT_REQUIRED' : joinResult.status === 404 ? 'LEAGUE_NOT_FOUND' : undefined)
    return NextResponse.json(
      { error: joinResult.error, ...(code ? { code } : {}) },
      { status: joinResult.status },
    )
  }

  return NextResponse.json(joinResult)
}

/**
 * GET /api/leagues/join?leagueId= — the shareable "claim your team" invite
 * link for a league (rides the existing /join?code=… flow this route's POST
 * consumes). Lives on this path instead of its own route because the app sits
 * at Vercel's 2048-route ceiling — adding any new route file fails the deploy
 * (too_many_routes), so new endpoints must reuse existing paths.
 *
 * Any member (owner or claimed team) can fetch it. Imported leagues often have
 * no invite code yet (settings.inviteCode is only minted by the create flow) —
 * this mints one on first request using the SAME settings.inviteCode contract
 * the join validation scans.
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const league = await prisma.league.findFirst({
    where: {
      id: leagueId,
      OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: { id: true, name: true, settings: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const { getFantasyInviteLink } = await import('@/lib/league-invite/LeagueInviteService')
  const baseUrl = req.nextUrl.origin

  let result = await getFantasyInviteLink(leagueId, baseUrl)
  if (!result.ok && result.error === 'NO_INVITE_CODE') {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L lookalikes
    const bytes = new Uint8Array(10)
    crypto.getRandomValues(bytes)
    let code = ''
    for (const b of bytes) code += alphabet[b % alphabet.length]
    const settings = (league.settings as Record<string, unknown> | null) ?? {}
    await prisma.league.update({
      where: { id: leagueId },
      data: { settings: { ...settings, inviteCode: code } },
    })
    result = await getFantasyInviteLink(leagueId, baseUrl)
  }

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })

  // Claim progress — how many of the league's teams have a real AF member
  // behind them. Powers the "N of M teams claimed" bar next to the invite link.
  const [teamCount, claimedCount] = await Promise.all([
    prisma.leagueTeam.count({ where: { leagueId } }).catch(() => 0),
    prisma.leagueTeam.count({ where: { leagueId, claimedByUserId: { not: null } } }).catch(() => 0),
  ])

  return NextResponse.json({
    leagueName: league.name,
    inviteCode: result.inviteCode,
    inviteLink: result.inviteLink,
    inviteExpiresAt: result.inviteExpiresAt,
    claim: { teamCount, claimedCount },
  })
}
