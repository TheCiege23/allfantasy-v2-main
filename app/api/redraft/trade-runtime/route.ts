import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'
import { parseOptionalRedraftPositiveInteger } from '@/lib/redraft/betaRouteInput'
import {
  actOnNflRedraftTradeProposal,
  castNflRedraftTradeVote,
  createNflRedraftTradeProposal,
  resolveNflRedraftTradeRuntime,
  type NflRedraftTradeAssetInput,
} from '@/lib/trade-runtime'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type TradeRuntimeAction =
  | 'accept'
  | 'cancel'
  | 'commissioner_approve'
  | 'commissioner_veto'
  | 'create_proposal'
  | 'expire'
  | 'reject'
  | 'vote_approve'
  | 'vote_veto'

type TradeRuntimeBody = {
  action?: TradeRuntimeAction
  seasonId?: string
  leagueId?: string
  proposalId?: string
  proposerRosterId?: string
  receiverRosterId?: string
  voterRosterId?: string
  assets?: NflRedraftTradeAssetInput[]
  vetoMode?: string | null
  vetoThreshold?: number | null
  reason?: string | null
  expiresInHours?: number | null
  commissionerOverride?: boolean
}

async function readBody(request: Request): Promise<TradeRuntimeBody> {
  try {
    return ((await request.json()) ?? {}) as TradeRuntimeBody
  } catch {
    return {}
  }
}

async function leagueIdFromInput(input: { seasonId?: string | null; leagueId?: string | null; proposalId?: string | null }) {
  if (input.leagueId?.trim()) return input.leagueId.trim()
  if (input.seasonId?.trim()) {
    const season = await prisma.redraftSeason.findUnique({
      where: { id: input.seasonId.trim() },
      select: { leagueId: true },
    })
    if (season?.leagueId) return season.leagueId
  }
  if (input.proposalId?.trim()) {
    const proposal = await prisma.redraftTradeProposal.findUnique({
      where: { id: input.proposalId.trim() },
      select: { leagueId: true },
    })
    if (proposal?.leagueId) return proposal.leagueId
  }
  return null
}

async function proposalAccess(proposalId: string, userId: string) {
  const proposal = await prisma.redraftTradeProposal.findUnique({
    where: { id: proposalId },
    select: {
      id: true,
      leagueId: true,
      seasonId: true,
      proposerRosterId: true,
      receiverRosterId: true,
      status: true,
    },
  })
  if (!proposal) return { ok: false as const, status: 404 as const, error: 'Proposal not found' }
  const rosters = await prisma.redraftRoster.findMany({
    where: { seasonId: proposal.seasonId, id: { in: [proposal.proposerRosterId, proposal.receiverRosterId] } },
    select: { id: true, ownerId: true },
  })
  const owners = new Map(rosters.map((roster: { id: string; ownerId: string | null }) => [roster.id, roster.ownerId]))
  const commissioner = await assertLeagueCommissioner(proposal.leagueId, userId)
  return {
    ok: true as const,
    proposal,
    isCommissioner: commissioner.ok,
    isProposer: owners.get(proposal.proposerRosterId) === userId,
    isReceiver: owners.get(proposal.receiverRosterId) === userId,
  }
}

async function rosterOwnerAccess(input: {
  leagueId: string
  seasonId?: string | null
  rosterId?: string | null
  userId: string
}) {
  if (!input.rosterId?.trim()) return { ok: false as const, status: 400 as const, error: 'rosterId required' }
  const roster = await prisma.redraftRoster.findFirst({
    where: {
      id: input.rosterId.trim(),
      leagueId: input.leagueId,
      ...(input.seasonId ? { seasonId: input.seasonId } : {}),
    },
    select: { id: true, ownerId: true, seasonId: true, leagueId: true },
  })
  if (!roster) return { ok: false as const, status: 404 as const, error: 'Roster not found' }
  if (roster.ownerId === input.userId) return { ok: true as const, roster, isCommissioner: false }
  const commissioner = await assertLeagueCommissioner(input.leagueId, input.userId)
  if (commissioner.ok) return { ok: true as const, roster, isCommissioner: true }
  return { ok: false as const, status: 403 as const, error: 'Forbidden' }
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const seasonId = req.nextUrl.searchParams.get('seasonId')?.trim() || null
  const leagueIdParam = req.nextUrl.searchParams.get('leagueId')?.trim() || null
  const week = req.nextUrl.searchParams.get('week')
  if (!seasonId && !leagueIdParam) {
    return NextResponse.json({ error: 'seasonId or leagueId required' }, { status: 400 })
  }

  const parsedWeek = parseOptionalRedraftPositiveInteger(week, 'week')
  if (!parsedWeek.ok) return NextResponse.json({ error: parsedWeek.error }, { status: 400 })

  const leagueId = await leagueIdFromInput({ seasonId, leagueId: leagueIdParam })
  if (!leagueId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await assertLeagueMember(leagueId, userId)
  if (!member.ok) return NextResponse.json({ error: 'Forbidden' }, { status: member.status })
  const commissioner = await assertLeagueCommissioner(leagueId, userId)

  const resolved = await resolveNflRedraftTradeRuntime({
    seasonId,
    leagueId,
    week: parsedWeek.value,
  })
  if (!resolved.ok) {
    const status = resolved.reason === 'season_not_found' || resolved.reason === 'league_not_found' ? 404 : 400
    return NextResponse.json({ error: resolved.reason }, { status })
  }
  return NextResponse.json({ trades: resolved.state, isCommissioner: commissioner.ok })
}

export async function POST(request: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await readBody(request)
  const action = body.action ?? 'create_proposal'
  const leagueId = await leagueIdFromInput({ seasonId: body.seasonId, leagueId: body.leagueId, proposalId: body.proposalId })
  if (!leagueId) return NextResponse.json({ error: 'seasonId, leagueId, or proposalId required' }, { status: 400 })
  const member = await assertLeagueMember(leagueId, userId)
  if (!member.ok) return NextResponse.json({ error: 'Forbidden' }, { status: member.status })

  try {
    if (action === 'create_proposal') {
      const proposerRosterId = body.proposerRosterId?.trim()
      const receiverRosterId = body.receiverRosterId?.trim()
      if (!proposerRosterId || !receiverRosterId) {
        return NextResponse.json({ error: 'proposerRosterId and receiverRosterId required' }, { status: 400 })
      }
      const access = await rosterOwnerAccess({ leagueId, seasonId: body.seasonId, rosterId: proposerRosterId, userId })
      if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
      const assets = Array.isArray(body.assets) ? body.assets : []
      const created = await createNflRedraftTradeProposal({
        leagueId,
        seasonId: access.roster.seasonId,
        proposerRosterId,
        receiverRosterId,
        assets,
        vetoMode: body.vetoMode,
        vetoThreshold: body.vetoThreshold,
        reason: body.reason,
        expiresInHours: body.expiresInHours,
        actorUserId: userId,
        commissionerOverride: access.isCommissioner && body.commissionerOverride === true,
      })
      const next = await resolveNflRedraftTradeRuntime({ seasonId: access.roster.seasonId })
      return NextResponse.json({ ok: true, proposal: created.proposal, validation: created.validation, trades: next.ok ? next.state : null })
    }

    const proposalId = body.proposalId?.trim()
    if (!proposalId) return NextResponse.json({ error: 'proposalId required' }, { status: 400 })
    const access = await proposalAccess(proposalId, userId)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    if (action === 'accept' || action === 'reject') {
      if (!access.isReceiver) return NextResponse.json({ error: 'Only receiver can accept or reject' }, { status: 403 })
      const result = await actOnNflRedraftTradeProposal({
        proposalId,
        action,
        actorUserId: userId,
        reason: body.reason,
      })
      return NextResponse.json({ ok: true, ...result })
    }

    if (action === 'cancel') {
      if (!access.isProposer && !access.isCommissioner) {
        return NextResponse.json({ error: 'Only proposer or commissioner can cancel' }, { status: 403 })
      }
      const result = await actOnNflRedraftTradeProposal({
        proposalId,
        action: 'cancel',
        actorUserId: userId,
        reason: body.reason,
        commissionerOverride: access.isCommissioner && !access.isProposer,
      })
      return NextResponse.json({ ok: true, ...result })
    }

    if (action === 'commissioner_approve' || action === 'commissioner_veto' || action === 'expire') {
      if (!access.isCommissioner) return NextResponse.json({ error: 'Commissioner action required' }, { status: 403 })
      const result = await actOnNflRedraftTradeProposal({
        proposalId,
        action,
        actorUserId: userId,
        reason: body.reason,
        commissionerOverride: true,
      })
      return NextResponse.json({ ok: true, ...result })
    }

    if (action === 'vote_approve' || action === 'vote_veto') {
      const voterRosterId = body.voterRosterId?.trim()
      const voterAccess = await rosterOwnerAccess({ leagueId, rosterId: voterRosterId, userId })
      if (!voterAccess.ok) return NextResponse.json({ error: voterAccess.error }, { status: voterAccess.status })
      const result = await castNflRedraftTradeVote({
        proposalId,
        voterRosterId: voterAccess.roster.id,
        vote: action === 'vote_veto' ? 'veto' : 'approve',
        actorUserId: userId,
        reason: body.reason,
      })
      return NextResponse.json({ ok: true, ...result })
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Trade runtime action failed'
    const status = message.includes('not_found') ? 404 : message.includes('not_pending') ? 409 : 400
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
