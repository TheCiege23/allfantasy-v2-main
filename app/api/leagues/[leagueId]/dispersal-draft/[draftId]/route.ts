import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { getLeagueRole } from '@/lib/league/permissions'
import {
  getRosterIdForLeagueUser,
  requireDispersalDraftForLeague,
} from '@/lib/league/dispersal-draft-route-helpers'
import { getDispersalDraftDetail } from '@/lib/dispersal-draft/dispersal-draft-detail'
import { DispersalDraftEngine } from '@/lib/dispersal-draft/DispersalDraftEngine'
import { prisma } from '@/lib/prisma'
import { requireEntitlement } from '@/lib/subscription/requireEntitlement'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string; draftId: string }> }) {
  try {
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { leagueId, draftId } = await ctx.params
    if (!leagueId || !draftId) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

    if (!(await canAccessLeagueDraft(leagueId, userId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const state = await DispersalDraftEngine.getDraftState(draftId)
    if (!state || state.leagueId !== leagueId) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    }
    return NextResponse.json(state)
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err))
    console.error('[dispersal-draft/[draftId] GET]', e?.message, e?.stack)
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}

type PatchBody = {
  action?: string
  playerId?: string
  isAutoPick?: boolean
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ leagueId: string; draftId: string }> }) {
  try {
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { leagueId, draftId } = await ctx.params
    if (!leagueId || !draftId) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

    if (!(await canAccessLeagueDraft(leagueId, userId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await requireDispersalDraftForLeague(draftId, leagueId)

    const body = (await req.json().catch(() => ({}))) as PatchBody
    const action = body.action

    if (action === 'start') {
      const ent = await requireEntitlement('commissioner_dispersal_draft')
      if (ent instanceof NextResponse) return ent
      const uid = ent
      const role = await getLeagueRole(leagueId, uid)
      if (role !== 'commissioner' && role !== 'co_commissioner') {
        return NextResponse.json({ error: 'Only the commissioner or co-commissioner can start the draft.' }, { status: 403 })
      }
      try {
        const state = await DispersalDraftEngine.startDraft(draftId, uid)
        const detail = await getDispersalDraftDetail(leagueId, draftId)
        return NextResponse.json({ state, detail })
      } catch (e) {
        console.error('[dispersal-draft/[draftId] PATCH start]', e instanceof Error ? e.message : e, e instanceof Error ? e.stack : '')
        const msg = e instanceof Error ? e.message : 'Start failed'
        return NextResponse.json({ error: msg }, { status: 400 })
      }
    }

    if (action === 'make_pick') {
      const pid = typeof body.playerId === 'string' ? body.playerId.trim() : ''
      if (!pid) return NextResponse.json({ error: 'playerId required' }, { status: 400 })
      const rosterId = await getRosterIdForLeagueUser(leagueId, userId)
      if (!rosterId) return NextResponse.json({ error: 'No roster for user in this league' }, { status: 400 })
      try {
        const state = await DispersalDraftEngine.makePick(draftId, rosterId, pid, {
          isAutoPick: body.isAutoPick === true,
        })
        const detail = await getDispersalDraftDetail(leagueId, draftId)
        return NextResponse.json({ state, detail })
      } catch (e) {
        console.error('[dispersal-draft/[draftId] PATCH make_pick]', e instanceof Error ? e.message : e, e instanceof Error ? e.stack : '')
        const msg = e instanceof Error ? e.message : 'Pick failed'
        return NextResponse.json({ error: msg }, { status: 400 })
      }
    }

    if (action === 'auto_pick') {
      const rosterId = await getRosterIdForLeagueUser(leagueId, userId)
      if (!rosterId) return NextResponse.json({ error: 'No roster for user in this league' }, { status: 400 })
      try {
        const state = await DispersalDraftEngine.advancePickOnTimeout(draftId, rosterId)
        const detail = await getDispersalDraftDetail(leagueId, draftId)
        return NextResponse.json({ state, detail })
      } catch (e) {
        console.error('[dispersal-draft/[draftId] PATCH auto_pick]', e instanceof Error ? e.message : e, e instanceof Error ? e.stack : '')
        const msg = e instanceof Error ? e.message : 'Auto-pick failed'
        return NextResponse.json({ error: msg }, { status: 400 })
      }
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err))
    console.error('[dispersal-draft/[draftId] PATCH]', e?.message, e?.stack)
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}

type PostBody = {
  action?: string
  assetId?: string
  playerId?: string
  rosterId?: string
  isAutoPick?: boolean
}

/**
 * Legacy/alternate clients that POST instead of PATCH (same actions).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string; draftId: string }> }) {
  try {
    const dispersalDraftClient = prisma.dispersalDraft
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { leagueId, draftId } = await ctx.params
    if (!leagueId || !draftId) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

    if (!(await canAccessLeagueDraft(leagueId, userId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await requireDispersalDraftForLeague(draftId, leagueId)

    const body = (await req.json().catch(() => ({}))) as PostBody
    const action = body.action

    const rosterIdToUse =
      typeof body.rosterId === 'string' && body.rosterId.trim()
        ? body.rosterId.trim()
        : await getRosterIdForLeagueUser(leagueId, userId)

    if (action === 'start') {
      const ent = await requireEntitlement('commissioner_dispersal_draft')
      if (ent instanceof NextResponse) return ent
      const uid = ent
      const role = await getLeagueRole(leagueId, uid)
      if (role !== 'commissioner' && role !== 'co_commissioner') {
        return NextResponse.json({ error: 'Only the commissioner or co-commissioner can start the draft.' }, { status: 403 })
      }
      const state = await DispersalDraftEngine.startDraft(draftId, uid)
      return NextResponse.json(state)
    }

    if (action === 'make_pick') {
      const assetKey =
        (typeof body.assetId === 'string' && body.assetId.trim()) ||
        (typeof body.playerId === 'string' && body.playerId.trim()) ||
        ''
      if (!assetKey) return NextResponse.json({ error: 'assetId or playerId required' }, { status: 400 })
      if (!rosterIdToUse) return NextResponse.json({ error: 'Roster not found for user in this league' }, { status: 404 })
      const state = await DispersalDraftEngine.makePick(draftId, rosterIdToUse, assetKey, {
        isAutoPick: body.isAutoPick === true,
      })
      return NextResponse.json(state)
    }

    if (action === 'pass') {
      if (!rosterIdToUse) return NextResponse.json({ error: 'Roster not found for user in this league' }, { status: 404 })
      const state = await DispersalDraftEngine.makePick(draftId, rosterIdToUse, 'PASS')
      return NextResponse.json(state)
    }

    if (action === 'auto_pick') {
      if (!rosterIdToUse) return NextResponse.json({ error: 'Roster not found for user in this league' }, { status: 404 })
      const state = await DispersalDraftEngine.advancePickOnTimeout(draftId, rosterIdToUse)
      return NextResponse.json(state)
    }

    if (action === 'complete') {
      const ent = await requireEntitlement('commissioner_dispersal_draft')
      if (ent instanceof NextResponse) return ent
      const uid = ent
      const role = await getLeagueRole(leagueId, uid)
      if (role !== 'commissioner' && role !== 'co_commissioner') {
        return NextResponse.json({ error: 'Only the commissioner or co-commissioner can force complete.' }, { status: 403 })
      }
      await dispersalDraftClient.update({
        where: { id: draftId, leagueId },
        data: {
          status: 'completed',
          completedAt: new Date(),
        },
      })
      await DispersalDraftEngine.completeDraft(draftId)
      const state = await DispersalDraftEngine.getDraftState(draftId)
      if (!state) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
      return NextResponse.json(state)
    }

    return NextResponse.json({ error: `Unknown action: ${action ?? '(missing)'}` }, { status: 400 })
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err))
    const msg = e.message ?? 'Internal error'
    console.error('[dispersal-draft/[draftId] POST]', msg, e?.stack)
    const clientErr = /not your pick|not active|not available|draft is not|cannot start|must|required|orphan|participant|commissioner|forbidden/i.test(
      msg
    )
    return NextResponse.json({ error: msg }, { status: clientErr ? 400 : 500 })
  }
}
