/**
 * GET: Active dispersal draft for league, or null.
 * POST: Create dispersal draft (commissioner + entitlement + dynasty + orphans).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { getLeagueRole } from '@/lib/league/permissions'
import { getOrphanRosterIdsForLeague, isOrphanPlatformUserId } from '@/lib/orphan-ai-manager/orphanRosterResolver'
import { prisma } from '@/lib/prisma'
import { requireEntitlement } from '@/lib/subscription/requireEntitlement'
import { isDispersalDraftDynastyEligible } from '@/lib/dispersal-draft/dynastyEligibility'
import { DispersalDraftEngine } from '@/lib/dispersal-draft/DispersalDraftEngine'
import type { DispersalDraftConfig } from '@/lib/dispersal-draft/types'
import {
  getSupportedEngineCoresForDraftType,
  mapCanonicalDraftTypeToEngineCore,
} from '@/lib/draft-types/draftTypeRegistry'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  try {
    const dispersalDraftClient = (prisma as any).dispersalDraft
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

    if (!(await canAccessLeagueDraft(leagueId, userId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const row = await dispersalDraftClient.findFirst({
      where: {
        leagueId,
        status: { in: ['pending', 'configuring', 'in_progress'] },
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        picks: { orderBy: { pickNumber: 'asc' } },
        participants: { orderBy: { draftSlot: 'asc' } },
      },
    })
    const state = row ? await DispersalDraftEngine.getDraftState(row.id) : null
    return NextResponse.json({
      data: state,
      draft: state,
      picks: row?.picks ?? [],
      participants: row?.participants ?? [],
    })
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err))
    console.error('[dispersal-draft GET]', e.message, e.stack)
    return NextResponse.json({ error: 'Internal server error', data: null, draft: null }, { status: 500 })
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  try {
    const ent = await requireEntitlement('commissioner_dispersal_draft')
    if (ent instanceof NextResponse) return ent
    const commissionerUserId = ent

    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

    const role = await getLeagueRole(leagueId, commissionerUserId)
    if (role !== 'commissioner' && role !== 'co_commissioner') {
      return NextResponse.json({ error: 'Only the commissioner or co-commissioner can create a dispersal draft.' }, { status: 403 })
    }

    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, isDynasty: true, leagueVariant: true, leagueType: true, settings: true },
    })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

    if (!isDispersalDraftDynastyEligible(league)) {
      return NextResponse.json({ error: 'Dispersal draft requires a dynasty league' }, { status: 400 })
    }

    const orphanIds = await getOrphanRosterIdsForLeague(leagueId)
    const orphanSet = new Set(orphanIds)

    const active = await DispersalDraftEngine.getActiveDraftForLeague(leagueId)
    if (active) {
      return NextResponse.json({ error: 'A dispersal draft is already active' }, { status: 409 })
    }

    const allRosters = await prisma.roster.findMany({
      where: { leagueId },
      select: { id: true, platformUserId: true },
    })
    const defaultParticipantRosterIds = allRosters
      .filter((r) => !isOrphanPlatformUserId(r.platformUserId))
      .map((r) => r.id)

    const body = (await req.json().catch(() => ({}))) as Partial<DispersalDraftConfig> & {
      sourceRosterIds?: string[]
      participantRosterIds?: string[]
      draftType?: string
    }

    let sourceRosterIds: string[]
    if (Array.isArray(body.sourceRosterIds) && body.sourceRosterIds.length > 0) {
      sourceRosterIds = [...new Set(body.sourceRosterIds.map(String))].filter((id) => orphanSet.has(id))
      if (sourceRosterIds.length < 2) {
        return NextResponse.json(
          { error: 'Select at least two valid orphan source rosters for the asset pool.' },
          { status: 400 }
        )
      }
    } else {
      sourceRosterIds = orphanIds
      if (sourceRosterIds.length < 2) {
        return NextResponse.json({ error: 'At least two orphan teams are required' }, { status: 400 })
      }
    }

    let participantRosterIds: string[]
    if (Array.isArray(body.participantRosterIds) && body.participantRosterIds.length > 0) {
      const wanted = [...new Set(body.participantRosterIds.map(String))]
      const valid = new Set(allRosters.map((r) => r.id))
      participantRosterIds = wanted.filter((id) => valid.has(id))
      for (const id of participantRosterIds) {
        const row = allRosters.find((r) => r.id === id)
        if (!row || isOrphanPlatformUserId(row.platformUserId)) {
          return NextResponse.json(
            { error: 'Participants must be non-orphan rosters in this league.' },
            { status: 400 }
          )
        }
      }
    } else {
      participantRosterIds = defaultParticipantRosterIds
    }

    if (participantRosterIds.length < 2) {
      return NextResponse.json(
        { error: 'Dispersal draft needs at least two non-orphan teams to participate' },
        { status: 400 }
      )
    }

    const orderMode = body.orderMode === 'commissioner_set' ? 'commissioner_set' : 'randomized'
    const rawPick = typeof body.pickTimeSeconds === 'number' && Number.isFinite(body.pickTimeSeconds) ? body.pickTimeSeconds : 120
    const pickTimeSeconds = Math.max(0, Math.min(600, Math.floor(rawPick)))
    const autoPickOnTimeout = body.autoPickOnTimeout !== false
    const scenario = body.scenario === 'league_downsizing' ? 'league_downsizing' : 'orphan_teams'

    const requestedDraftType = typeof body.draftType === 'string' ? body.draftType.trim().toLowerCase() : ''
    const requestedEngineCore = requestedDraftType
      ? mapCanonicalDraftTypeToEngineCore(requestedDraftType)
      : 'linear'
    const supportedForDispersal = getSupportedEngineCoresForDraftType('dispersal_draft')
    if (!supportedForDispersal.includes(requestedEngineCore)) {
      return NextResponse.json(
        {
          error: `Draft type "${requestedDraftType || requestedEngineCore}" is not allowed for dispersal drafts.`,
          allowedEngineCores: supportedForDispersal,
        },
        { status: 400 }
      )
    }
    // Dispersal order construction is still linear in the engine today; keep
    // API-level validation explicit and block unsupported execution to prevent
    // accepting a type that won't execute correctly.
    if (requestedEngineCore !== 'linear') {
      return NextResponse.json(
        {
          error: `Draft type "${requestedEngineCore}" is not implemented for dispersal draft execution yet; use "linear".`,
          allowedNow: ['linear'],
          supportedEngineCores: supportedForDispersal,
        },
        { status: 400 }
      )
    }
    const draftType: DispersalDraftConfig['draftType'] = requestedEngineCore

    const config: DispersalDraftConfig = {
      leagueId,
      scenario,
      sourceRosterIds,
      participantRosterIds,
      orderMode,
      manualOrder: Array.isArray(body.manualOrder) ? body.manualOrder.map(String) : undefined,
      pickTimeSeconds,
      autoPickOnTimeout,
      draftType,
    }

    try {
      const draftState = await DispersalDraftEngine.createDraft(config, commissionerUserId)
      return NextResponse.json({
        data: draftState,
        draft: draftState,
        draftId: draftState.id,
      })
    } catch (e) {
      const ex = e instanceof Error ? e : new Error(String(e))
      console.error('[dispersal-draft POST createDraft]', ex.message, ex.stack)
      const msg = ex.message || 'Failed to create draft'
      return NextResponse.json({ error: msg, data: null, draft: null }, { status: 400 })
    }
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err))
    console.error('[dispersal-draft POST]', e.message, e.stack)
    return NextResponse.json({ error: 'Internal server error', data: null, draft: null }, { status: 500 })
  }
}
