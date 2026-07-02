import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'
import {
  addNflRedraftFreeAgent,
  cancelNflRedraftWaiverClaim,
  editNflRedraftWaiverClaim,
  processNflRedraftWaiverWindow,
  resolveNflRedraftWaiverRuntime,
  submitNflRedraftWaiverClaim,
  type NflRedraftWaiverRuntimeState,
} from '@/lib/waiver-runtime'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type WaiverRuntimeAction =
  | 'add_free_agent'
  | 'apply_commissioner_override'
  | 'cancel_claim'
  | 'edit_claim'
  | 'process_waivers'
  | 'submit_claim'

type WaiverRuntimeBody = {
  action?: WaiverRuntimeAction
  seasonId?: string
  leagueId?: string
  rosterId?: string
  claimId?: string
  addPlayerId?: string
  addPlayerName?: string
  addPlayerPosition?: string
  addPlayerTeam?: string
  dropPlayerId?: string | null
  dropPlayerName?: string | null
  bidAmount?: number | null
  conditionalGroupId?: string | null
  conditionalRank?: number | null
  conditionalClaims?: Array<{
    addPlayerId?: string
    addPlayerName?: string
    addPlayerPosition?: string
    addPlayerTeam?: string
    dropPlayerId?: string | null
    dropPlayerName?: string | null
    bidAmount?: number | null
  }>
  commissionerOverride?: boolean
}
async function readBody(request: Request): Promise<WaiverRuntimeBody> {
  try {
    return ((await request.json()) ?? {}) as WaiverRuntimeBody
  } catch {
    return {}
  }
}

async function leagueIdFromInput(input: { seasonId?: string | null; leagueId?: string | null }): Promise<string | null> {
  if (input.leagueId?.trim()) return input.leagueId.trim()
  if (!input.seasonId?.trim()) return null
  const season = await prisma.redraftSeason.findUnique({
    where: { id: input.seasonId.trim() },
    select: { leagueId: true },
  })
  return season?.leagueId ?? null
}

async function rosterAccess(input: {
  rosterId?: string | null
  seasonId?: string | null
  leagueId: string
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

function filteredForMember(
  state: NflRedraftWaiverRuntimeState,
  input: { rosterId?: string | null; isCommissioner: boolean; leagueScope: boolean },
): NflRedraftWaiverRuntimeState {
  if (input.isCommissioner && input.leagueScope) return state
  const rosterId = input.rosterId?.trim()
  if (!rosterId) return { ...state, pendingClaims: [] }
  return {
    ...state,
    pendingClaims: state.pendingClaims.filter((claim) => claim.rosterId === rosterId),
  }
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const seasonId = req.nextUrl.searchParams.get('seasonId')?.trim() || null
  const leagueIdParam = req.nextUrl.searchParams.get('leagueId')?.trim() || null
  const rosterId = req.nextUrl.searchParams.get('rosterId')?.trim() || null
  const week = req.nextUrl.searchParams.get('week')
  const scope = req.nextUrl.searchParams.get('scope') ?? 'mine'
  const includeFreeAgents = req.nextUrl.searchParams.get('includeFreeAgents') === '1'
  if (!seasonId && !leagueIdParam) {
    return NextResponse.json({ error: 'seasonId or leagueId required' }, { status: 400 })
  }

  const leagueId = await leagueIdFromInput({ seasonId, leagueId: leagueIdParam })
  if (!leagueId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const member = await assertLeagueMember(leagueId, userId)
  if (!member.ok) return NextResponse.json({ error: 'Forbidden' }, { status: member.status })
  const commissioner = await assertLeagueCommissioner(leagueId, userId)
  const wantsLeagueScope = scope === 'league'
  if (wantsLeagueScope && !commissioner.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const resolved = await resolveNflRedraftWaiverRuntime({
    seasonId,
    leagueId,
    week: week != null ? Number(week) : null,
    includeFreeAgents,
  })
  if (!resolved.ok) {
    const status = resolved.reason === 'season_not_found' || resolved.reason === 'league_not_found' ? 404 : 400
    return NextResponse.json({ error: resolved.reason }, { status })
  }

  return NextResponse.json({
    waivers: filteredForMember(resolved.state, {
      rosterId,
      isCommissioner: commissioner.ok,
      leagueScope: wantsLeagueScope,
    }),
    scope: wantsLeagueScope ? 'league' : 'mine',
    isCommissioner: commissioner.ok,
  })
}

export async function POST(request: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await readBody(request)
  const action = body.action ?? 'submit_claim'
  const leagueId = await leagueIdFromInput({ seasonId: body.seasonId, leagueId: body.leagueId })
  if (!leagueId) return NextResponse.json({ error: 'seasonId or leagueId required' }, { status: 400 })
  const member = await assertLeagueMember(leagueId, userId)
  if (!member.ok) return NextResponse.json({ error: 'Forbidden' }, { status: member.status })

  try {
    if (action === 'process_waivers' || action === 'apply_commissioner_override') {
      const commissioner = await assertLeagueCommissioner(leagueId, userId)
      if (!commissioner.ok) return NextResponse.json({ error: 'Forbidden' }, { status: commissioner.status })
      const result = await processNflRedraftWaiverWindow({
        seasonId: body.seasonId,
        leagueId,
        actorUserId: userId,
        commissionerOverride: action === 'apply_commissioner_override' || body.commissionerOverride === true,
      })
      return NextResponse.json({ ok: true, results: result.results, waivers: result.state })
    }

    const access = await rosterAccess({ rosterId: body.rosterId, seasonId: body.seasonId, leagueId, userId })
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
    const commissionerOverride = body.commissionerOverride === true && access.isCommissioner

    if (action === 'submit_claim') {
      const addPlayerId = body.addPlayerId?.trim()
      const conditionalClaims = Array.isArray(body.conditionalClaims) ? body.conditionalClaims : []
      if (!addPlayerId && conditionalClaims.length === 0) {
        return NextResponse.json({ error: 'addPlayerId or conditionalClaims required' }, { status: 400 })
      }
      const groupId = body.conditionalGroupId?.trim() || (conditionalClaims.length > 0 ? `group:${access.roster.id}:${randomUUID()}` : undefined)
      const claims = []
      const submitOne = async (
        claimBody: NonNullable<WaiverRuntimeBody['conditionalClaims']>[number] | WaiverRuntimeBody,
        rank: number,
      ) => {
        const id = claimBody.addPlayerId?.trim()
        if (!id) throw new Error('addPlayerId required')
        return submitNflRedraftWaiverClaim({
          seasonId: body.seasonId,
          leagueId,
          rosterId: access.roster.id,
          addPlayerId: id,
          addPlayerName: claimBody.addPlayerName,
          addPlayerPosition: claimBody.addPlayerPosition,
          addPlayerTeam: claimBody.addPlayerTeam,
          dropPlayerId: claimBody.dropPlayerId,
          dropPlayerName: claimBody.dropPlayerName,
          bidAmount: claimBody.bidAmount,
          conditionalGroupId: groupId,
          conditionalRank: claimBody === body ? body.conditionalRank ?? rank : rank,
          actorUserId: userId,
        })
      }
      if (conditionalClaims.length > 0) {
        for (let i = 0; i < conditionalClaims.length; i += 1) {
          claims.push(await submitOne(conditionalClaims[i], i + 1))
        }
      } else {
        claims.push(await submitOne(body, body.conditionalRank ?? 1))
      }
      return NextResponse.json({ ok: true, claims })
    }

    if (action === 'edit_claim') {
      if (!body.claimId?.trim()) return NextResponse.json({ error: 'claimId required' }, { status: 400 })
      const claim = await editNflRedraftWaiverClaim({
        claimId: body.claimId.trim(),
        seasonId: body.seasonId,
        leagueId,
        rosterId: access.roster.id,
        addPlayerId: body.addPlayerId ?? '',
        addPlayerName: body.addPlayerName,
        addPlayerPosition: body.addPlayerPosition,
        addPlayerTeam: body.addPlayerTeam,
        dropPlayerId: body.dropPlayerId,
        dropPlayerName: body.dropPlayerName,
        bidAmount: body.bidAmount,
        conditionalGroupId: body.conditionalGroupId,
        conditionalRank: body.conditionalRank,
        actorUserId: userId,
      })
      return NextResponse.json({ ok: true, ...claim })
    }

    if (action === 'cancel_claim') {
      if (!body.claimId?.trim()) return NextResponse.json({ error: 'claimId required' }, { status: 400 })
      const claim = await cancelNflRedraftWaiverClaim({
        claimId: body.claimId.trim(),
        rosterId: access.roster.id,
        actorUserId: userId,
      })
      return NextResponse.json({ ok: true, ...claim })
    }

    if (action === 'add_free_agent') {
      if (!body.addPlayerId?.trim()) return NextResponse.json({ error: 'addPlayerId required' }, { status: 400 })
      const result = await addNflRedraftFreeAgent({
        seasonId: body.seasonId,
        leagueId,
        rosterId: access.roster.id,
        addPlayerId: body.addPlayerId.trim(),
        addPlayerName: body.addPlayerName,
        addPlayerPosition: body.addPlayerPosition,
        addPlayerTeam: body.addPlayerTeam,
        dropPlayerId: body.dropPlayerId,
        dropPlayerName: body.dropPlayerName,
        actorUserId: userId,
        commissionerOverride,
      })
      return NextResponse.json({ ok: true, ...result })
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Waiver runtime action failed' },
      { status: 400 },
    )
  }
}
