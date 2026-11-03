import { loadWaiverPhasePolicy } from '@/lib/waiver-wire/season-phase-gate'
import { isAcceptedCoOwnerForRedraftRoster } from '@/lib/team-coowners/access'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import {
  isRedraftLeagueMovesLocked,
  REDRAFT_MOVES_LOCKED_CODE,
  REDRAFT_MOVES_LOCKED_STATUS,
  REDRAFT_ROSTER_MOVES_LOCKED_MESSAGE,
} from '@/lib/redraft/tradeMoveLock'
import { recordAfLearningEvent } from '@/lib/ai-learning-system/recordEvent'
import { resolveLeagueSport } from '@/lib/ai-learning-system/resolveLeagueSport'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const seasonId = req.nextUrl.searchParams?.get('seasonId')?.trim()
  const rosterId = req.nextUrl.searchParams?.get('rosterId')?.trim()
  if (!seasonId || !rosterId) {
    return NextResponse.json({ error: 'seasonId and rosterId required' }, { status: 400 })
  }

  const season = await prisma.redraftSeason.findFirst({ where: { id: seasonId } })
  if (!season) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const gate = await assertLeagueMember(season.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const roster = await prisma.redraftRoster.findFirst({
    where: { id: rosterId, seasonId, leagueId: season.leagueId },
    select: { ownerId: true },
  })
  if (!roster) return NextResponse.json({ error: 'Roster not found' }, { status: 404 })
  if (roster.ownerId !== userId && !await isAcceptedCoOwnerForRedraftRoster(season.leagueId, rosterId, userId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const claims = await prisma.redraftWaiverClaim.findMany({
    where: { seasonId, rosterId },
    orderBy: { submittedAt: 'desc' },
  })

  return NextResponse.json({ claims })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    rosterId?: string
    seasonId?: string
    leagueId?: string
    addPlayerId?: string
    addPlayerName?: string
    dropPlayerId?: string
    dropPlayerName?: string
    bidAmount?: number
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rosterId = body.rosterId?.trim()
  const seasonId = body.seasonId?.trim()
  const leagueId = body.leagueId?.trim()
  const addPlayerId = body.addPlayerId?.trim()
  const addPlayerName = body.addPlayerName?.trim() ?? 'Player'

  if (!rosterId || !seasonId || !leagueId || !addPlayerId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const roster = await prisma.redraftRoster.findFirst({
    where: { id: rosterId, seasonId, leagueId },
    select: { ownerId: true, waiverPriority: true },
  })
  if (!roster) return NextResponse.json({ error: 'Roster not found' }, { status: 404 })
  if (roster.ownerId !== userId && !await isAcceptedCoOwnerForRedraftRoster(leagueId, rosterId, userId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const phasePolicy = await loadWaiverPhasePolicy(leagueId, null)
  if (!phasePolicy.claimsAllowed) return NextResponse.json({ error: phasePolicy.reason, code: phasePolicy.code }, { status: 409 })

  // The commissioner's move lock, which the waiver screen's claim path (assertWaiverClaimEligibility) and the
  // NFL runtime already refuse under. This route has no UI caller; without it a claim was queued anyway.
  // Cancelling a pending claim (DELETE) moves nothing and stays open.
  if (await isRedraftLeagueMovesLocked(leagueId)) {
    return NextResponse.json(
      { error: REDRAFT_ROSTER_MOVES_LOCKED_MESSAGE, code: REDRAFT_MOVES_LOCKED_CODE },
      { status: REDRAFT_MOVES_LOCKED_STATUS },
    )
  }

  const bidAmount = body.bidAmount == null ? null : Number(body.bidAmount)
  if (bidAmount != null && (!Number.isFinite(bidAmount) || bidAmount < 0)) {
    return NextResponse.json({ error: 'Invalid bid amount' }, { status: 400 })
  }

  const existingPending = await prisma.redraftWaiverClaim.findFirst({
    where: {
      seasonId,
      leagueId,
      rosterId,
      addPlayerId,
      dropPlayerId: body.dropPlayerId ?? null,
      status: 'pending',
    },
  })
  if (existingPending) return NextResponse.json({ claim: existingPending, duplicate: true })

  const claim = await prisma.redraftWaiverClaim.create({
    data: {
      seasonId,
      leagueId,
      rosterId,
      addPlayerId,
      addPlayerName,
      dropPlayerId: body.dropPlayerId ?? null,
      dropPlayerName: body.dropPlayerName ?? null,
      bidAmount,
      priority: roster.waiverPriority,
    },
  })

  void resolveLeagueSport(leagueId).then((sport) =>
    recordAfLearningEvent({
      eventType: 'waiver_claim_submitted',
      sport,
      leagueId,
      userId,
      source: 'redraft_waiver_claim',
      payload: {
        claimId: claim.id,
        bidAmount,
        hasDrop: Boolean(body.dropPlayerId),
      },
    }),
  )

  return NextResponse.json({ claim })
}

export async function DELETE(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { claimId?: string; rosterId?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const claimId = body.claimId?.trim()
  const rosterId = body.rosterId?.trim()
  if (!claimId || !rosterId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const c = await prisma.redraftWaiverClaim.findFirst({ where: { id: claimId, rosterId } })
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const roster = await prisma.redraftRoster.findFirst({
    where: { id: rosterId, seasonId: c.seasonId, leagueId: c.leagueId },
    select: { ownerId: true },
  })
  if (!roster) return NextResponse.json({ error: 'Roster not found' }, { status: 404 })
  if (roster.ownerId !== userId && !await isAcceptedCoOwnerForRedraftRoster(c.leagueId, rosterId, userId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (c.status !== 'pending') return NextResponse.json({ error: 'Only pending claims can be cancelled' }, { status: 409 })

  await prisma.redraftWaiverClaim.update({
    where: { id: claimId },
    data: { status: 'cancelled' },
  })

  return NextResponse.json({ ok: true })
}
