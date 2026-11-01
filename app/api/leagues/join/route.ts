/**
 * POST /api/leagues/join — Join a league by invite code (and optional password).
 * Body: { code: string, password?: string }
 * Creates a Roster for the user if not already a member.
 *
 * Body: { action: 'request_class_exception', code?: string, token?: string }
 * A manager the division gate refused asks the commissioner to let them in
 * (`lib/league-join/classRequests.ts`). On this path rather than its own route
 * because of the route ceiling noted on GET below (ported from PR #1753). The
 * league's code or a `/join/<token>` token proves the manager was handed the way
 * in — a bare league id would let anyone queue requests at any league.
 */

import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { getServedOrigin } from '@/lib/http/served-origin'
import { authOptions } from '@/lib/auth'
import { validateFantasyInviteCode } from '@/lib/league-invite'
import { divisionGateRefusal, evaluateJoinDivisionGate } from '@/lib/league-join/joinDivisionGate'
import { requestClassException } from '@/lib/league-join/classRequests'
import { prisma } from '@/lib/prisma'
import { notifyCommissionerOfJoin } from '@/lib/league-join/notifyCommissionerOfJoin'
import { resolveGuillotineSeatSummary } from '@/lib/guillotine/lateStartSeats'
import { assertPaidJoinAllowed, linkDuesToRoster } from '@/lib/league-finance/joinGate'
import { claimPlaceholderRoster } from '@/lib/league-import/placeholderClaim'
import { findExistingLeagueClaim } from '@/lib/identity/linkedAccounts'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { isImportedPlatform } from '@/lib/league/isNativeLeague'
import { isPaidLeagueSettings } from '@/lib/league/paidLeague'
import { paidLeagueGeoMessage, paidLeagueGeoVerdict } from '@/lib/geo/paidLeagueGeo'
import {
  CLAIM_REFUSAL_MESSAGE,
  listClaimableSleeperTeams,
  startSleeperTeamClaim,
  verifySleeperTeamClaim,
} from '@/lib/league-join/sleeperOwnershipClaim'

export const dynamic = 'force-dynamic'

async function resolveInvitedLeagueId(code: string | null, token: string | null): Promise<string | null> {
  if (token) {
    const invite = await prisma.leagueInvite.findFirst({
      where: { token, isActive: true },
      select: { leagueId: true },
    })
    if (invite) return invite.leagueId
  }
  if (code) {
    // A tracked invite link (`/invite/accept`) carries its own token, not the league's code.
    const { getInviteByToken } = await import('@/lib/invite-engine/InviteEngine')
    const { normalizeToken } = await import('@/lib/invite-engine/tokenGenerator')
    const tracked = normalizeToken(code)
    const link = tracked ? await getInviteByToken(tracked).catch(() => null) : null
    if (link?.type === 'league' && link.targetId) return link.targetId
    const validation = await validateFantasyInviteCode(code)
    if (validation.valid) return validation.preview.leagueId
    return validation.preview?.leagueId ?? null
  }
  return null
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Sign in to join a league' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const code = typeof body.code === 'string' ? body.code.trim() : null
  const password = typeof body.password === 'string' ? body.password : undefined

  if (body.action === 'request_class_exception') {
    const token = typeof body.token === 'string' ? body.token.trim() : null
    const leagueId = await resolveInvitedLeagueId(code, token)
    if (!leagueId) return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    const requested = await requestClassException({ leagueId, userId })
    if (!requested.ok) return NextResponse.json({ error: requested.error }, { status: requested.status })
    return NextResponse.json({ success: true, leagueId, requestStatus: requested.status })
  }

  /*
   * Claim YOUR Sleeper team by proving the account (lib/league-join/sleeperOwnershipClaim.ts): list the
   * unclaimed teams, get a code to put in your Sleeper team name, verify it. On this path rather than
   * its own route because of the route ceiling noted on GET below. Members only — the helper checks.
   */
  if (body.action === 'sleeper_claim_teams' || body.action === 'sleeper_claim_start' || body.action === 'sleeper_claim_verify') {
    const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
    const teamExternalId = typeof body.teamExternalId === 'string' ? body.teamExternalId.trim() : ''
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
    if (body.action === 'sleeper_claim_teams') {
      const member =
        (await prisma.redraftLeagueMember.findUnique({ where: { leagueId_userId: { leagueId, userId } }, select: { id: true } })) ??
        (await prisma.league.findFirst({ where: { id: leagueId, userId }, select: { id: true } }))
      if (!member) return NextResponse.json({ error: CLAIM_REFUSAL_MESSAGE.not_member }, { status: 403 })
      return NextResponse.json({ teams: await listClaimableSleeperTeams(leagueId) })
    }
    if (!teamExternalId) return NextResponse.json({ error: 'Missing teamExternalId' }, { status: 400 })
    const result =
      body.action === 'sleeper_claim_start'
        ? await startSleeperTeamClaim({ userId, leagueId, teamExternalId })
        : await verifySleeperTeamClaim({ userId, leagueId, teamExternalId })
    if (result.ok) return NextResponse.json(result)
    const status =
      result.reason === 'not_member' || result.reason === 'linked_elsewhere' || result.reason === 'other_account'
        ? 403
        : result.reason === 'payment_required'
          ? 402
          : result.reason === 'sleeper_unavailable'
            ? 503
            : result.reason === 'team_not_found'
              ? 404
              : 409
    return NextResponse.json(
      {
        error: CLAIM_REFUSAL_MESSAGE[result.reason],
        code: result.reason,
        ...('seenTeamName' in result && result.seenTeamName !== undefined ? { seenTeamName: result.seenTeamName } : {}),
      },
      { status },
    )
  }

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

  /*
   * The division gate (ADR F2.10a), replacing the XP-level gate retired 2026-10-01: career XP
   * measures volume, not skill, and gating on it is what the owner ruled out. Only an OPEN join
   * — this league publishes its code — can be refused; a private league's code is an invitation.
   */
  /*
   * Paid leagues are restricted in some states (lib/geo/restrictedStates). Find a League already
   * hides them there; this is the gate for a code that arrives some other way. Paid means the
   * settings say so or league finance does — either is enough.
   */
  const [paidSettings, paidFinance] = await Promise.all([
    prisma.league.findUnique({ where: { id: result.leagueId }, select: { settings: true } }),
    prisma.leagueFinance.findUnique({ where: { leagueId: result.leagueId }, select: { isPaidLeague: true, entryFeeCents: true } }),
  ])
  const isPaidLeague =
    isPaidLeagueSettings(paidSettings?.settings) || Boolean(paidFinance?.isPaidLeague && paidFinance.entryFeeCents > 0)
  if (isPaidLeague) {
    const paidGeo = await paidLeagueGeoVerdict(req, userId)
    if (paidGeo.blocked) {
      return NextResponse.json(
        { error: paidLeagueGeoMessage(paidGeo, 'join'), code: 'PAID_GEO_BLOCKED' },
        { status: 451 },
      )
    }
  }

  const divisionGate = await evaluateJoinDivisionGate({
    userId,
    leagueId: result.leagueId,
    credential: { kind: 'league_code' },
  })
  if (divisionGate.outcome === 'deny') {
    return NextResponse.json(divisionGateRefusal(divisionGate, result.leagueId), { status: 403 })
  }

  const joinResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Serialize capacity checks and seat claims for this league. Two requests must
    // not both accept the final open seat from the same pre-claim snapshot.
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${result.leagueId} FOR UPDATE`
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
          userId: true,
        },
      }),
      tx.roster.findMany({
        where: { leagueId: result.leagueId },
        select: { platformUserId: true },
      }),
      tx.draftSession.findFirst({
        where: { leagueId: result.leagueId },
        orderBy: CURRENT_DRAFT_SESSION_ORDER,
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

    /*
     * 🛑 AN IMPORTED LEAGUE IS JOINED AS A MEMBER — NEVER BY TAKING, OR MAKING, A TEAM.
     *
     * Its teams are the provider's managers. This route used to hand one over by DISPLAY-NAME match
     * (`claimPlaceholderRoster`): pick a display name equal to another manager's and their roster was
     * yours, with no proof. Owning a Sleeper account cannot be proven here yet (a Sleeper link is a
     * typed username — see `sleeper-identity-has-no-ownership-proof`), so no join by link may claim
     * an imported team. And when nothing matched it created a fresh EMPTY roster: a thirteenth team
     * in a twelve-team Sleeper league. Even a correct name match could not mark the team as yours,
     * because an import's `LeagueTeam.externalId` is the provider's roster number, never `Roster.id`
     * (production 2026-10-12: 0 of 6,967 imported teams line up).
     *
     * What a leaguemate arriving from a shared recap wants is the league's chat and recaps, and a
     * `RedraftLeagueMember` row is what `resolveLeagueMembership` admits for that. Their team is
     * claimed through the identity-checked invite flow (`/join/<token>`), which refuses a team linked
     * to another manager's account.
     */
    if (isImportedPlatform(league.platform)) {
      const alreadyMember = await tx.redraftLeagueMember.findUnique({
        where: { leagueId_userId: { leagueId: result.leagueId, userId } },
        select: { id: true },
      })
      if (!alreadyMember) {
        await tx.redraftLeagueMember.create({
          data: { leagueId: result.leagueId, userId, role: 'MEMBER', teamNumber: null },
        })
      }
      return {
        success: true as const,
        leagueId: result.leagueId,
        alreadyMember: Boolean(alreadyMember),
        memberOnly: true as const,
        // A Sleeper league's team can be claimed by proving the account — the page offers it.
        sleeperClaim: String(league.platform).toLowerCase() === 'sleeper',
      }
    }

    const realRosterUsers = await tx.appUser.findMany({
      where: { id: { in: leagueRosters.map((r: { platformUserId: string }) => r.platformUserId) } },
      select: { id: true },
    })
    const claimedRosterCount = realRosterUsers.length

    if (league.leagueSize != null && claimedRosterCount >= league.leagueSize) {
      return { success: false as const, status: 409, error: 'League is full' }
    }

    if ((league.leagueVariant === 'survivor' || league.leagueVariant === 'survivor_guillotine') &&
        draftSession?.status && draftSession.status !== 'pre_draft') {
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
      // Record the membership now: the manager has passed every gate above, and the team
      // picker (`/api/leagues/{id}/claim-roster`) admits only members of the league.
      await tx.redraftLeagueMember.upsert({
        where: { leagueId_userId: { leagueId: result.leagueId, userId } },
        create: { leagueId: result.leagueId, userId, role: 'MEMBER', teamNumber: null },
        update: {},
      })
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

    // An upsert, not `.create().catch()`: a native seat claim has already written this row, and
    // inside a Postgres transaction the duplicate insert's error aborts the transaction — the
    // `.catch` hides the error but every later statement then fails and the join rolls back.
    await tx.redraftLeagueMember.upsert({
      where: { leagueId_userId: { leagueId: result.leagueId, userId } },
      create: { leagueId: result.leagueId, userId, role: 'MEMBER', teamNumber },
      update: teamNumber != null ? { teamNumber } : {},
    })

    if (league.platform === 'manual') {
      const manualTeamCount = await tx.leagueTeam.count({
        where: { leagueId: result.leagueId },
      })
      if (league.leagueSize == null || manualTeamCount < league.leagueSize) {
        const displayName = profile?.displayName?.trim() || profile?.sleeperUsername?.trim() || 'Manager'
        const teamBaseName = league.name?.trim() || 'League'
        /*
         * 🛑 CLAIMED, AND AN UPSERT. This was a bare `create` of an UNCLAIMED row — no
         * `claimedByUserId`, no `platformUserId` — so the new manager held the roster while every
         * reader that finds your team by its claim (the redraft member check, the Career Wire, the
         * home brief) could not see them. Production 2026-10-01: a manager at 1-2 with exactly that
         * row. And `assignLeagueSeat` now creates a native seat's row itself, so on the placeholder
         * path the row already exists: a duplicate insert inside this transaction aborts it, which
         * the `.catch` that used to sit here could hide but never undo. An existing row is left to
         * the seat writer that made it.
         */
        await tx.leagueTeam.upsert({
          where: { leagueId_externalId: { leagueId: result.leagueId, externalId: roster.id } },
          create: {
            leagueId: result.leagueId,
            externalId: roster.id,
            ownerName: displayName,
            teamName: `${displayName}'s ${teamBaseName} Team`,
            claimedByUserId: userId,
            platformUserId: userId,
            isOrphan: false,
            isCommissioner: userId === league.userId,
            role: userId === league.userId ? 'commissioner' : 'member',
          },
          update: {},
        })
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

  if (!joinResult.alreadyMember) {
    // After the commit, and never awaited by the response: the join stands whatever the alert does.
    void notifyCommissionerOfJoin({ leagueId: joinResult.leagueId, joinerUserId: userId }).catch((err) => {
      console.warn('[league-join] commissioner join alert failed', { leagueId: joinResult.leagueId, error: err instanceof Error ? err.message : String(err) })
    })
  }

  return NextResponse.json(
    divisionGate.outcome === 'allow_flagged' && !joinResult.alreadyMember
      ? { ...joinResult, divisionFlag: { reason: divisionGate.reason, userDivision: divisionGate.userDivision, leagueDivision: divisionGate.leagueDivision } }
      : joinResult,
  )
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
  const baseUrl = getServedOrigin(req)

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
  const [teamCount, claimedCount, guillotineSeats] = await Promise.all([
    prisma.leagueTeam.count({ where: { leagueId } }).catch(() => 0),
    prisma.leagueTeam.count({ where: { leagueId, claimedByUserId: { not: null } } }).catch(() => 0),
    // Native guillotine only: seats left in the season, the draft time, and what happens if not full.
    resolveGuillotineSeatSummary(leagueId).catch(() => null),
  ])

  return NextResponse.json({
    leagueName: league.name,
    inviteCode: result.inviteCode,
    inviteLink: result.inviteLink,
    inviteExpiresAt: result.inviteExpiresAt,
    claim: { teamCount, claimedCount },
    guillotineSeats,
  })
}
