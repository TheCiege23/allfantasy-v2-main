import { NextResponse } from 'next/server'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { requireDispersalDraftForLeague } from '@/lib/league/dispersal-draft-route-helpers'
import { DispersalDraftEngine } from '@/lib/dispersal-draft/DispersalDraftEngine'
import { prisma } from '@/lib/prisma'
import { requireEntitlement } from '@/lib/subscription/requireEntitlement'
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: { params: Promise<{ leagueId: string; draftId: string }> }) {
  try {
    const ent = await requireEntitlement('commissioner_dispersal_draft')
    if (ent instanceof NextResponse) return ent
    const userId = ent

    const { leagueId, draftId } = await ctx.params
    // Membership gate. This route was reachable by anyone holding a league id.
    const gate = await requireLeagueApiAccess(leagueId)
    if (!gate.ok) return gate.response
    if (!leagueId || !draftId) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

    try {
      await assertCommissioner(leagueId, userId)
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    try {
      await requireDispersalDraftForLeague(draftId, leagueId)
    } catch (e) {
      const status = (e as Error & { status?: number }).status ?? 404
      return NextResponse.json({ error: 'Draft not found' }, { status })
    }

    await (prisma as any).dispersalDraft.update({
      where: { id: draftId },
      data: {
        status: 'completed',
        completedAt: new Date(),
      },
    })

    await DispersalDraftEngine.completeDraft(draftId)
    const state = await DispersalDraftEngine.getDraftState(draftId)
    return NextResponse.json({ ok: true, draft: state })
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err))
    console.error('[dispersal-draft/[draftId]/complete POST]', e.message, e.stack)
    return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
  }
}
