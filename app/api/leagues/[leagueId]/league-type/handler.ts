/**
 * GET:   what format we think this league is, and whether anyone has confirmed.
 * PATCH: record a human's decision.
 *
 * ⚠ A HANDLER, NOT A ROUTE. This repo sits at Vercel's hard 2048-route ceiling,
 * and the `[section]` dispatcher exists so a new league endpoint costs zero
 * routes. Adding `route.ts` here instead would spend one of the last slots.
 *
 * ⚠ CONFIRMATION IS COMMISSIONER-ONLY. Confirming a format changes what every
 * season in that league is worth in the ranking — a member could otherwise
 * relabel a casual redraft as a zombie league and inflate the whole league's
 * standing. Reading is open to any member so the prompt can be shown.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { leagueTypeState, confirmLeagueType } from '@/lib/career/leagueTypeConfirmation'

export const dynamic = 'force-dynamic'

async function requireMember(
  ctx: { params: Promise<{ leagueId: string }> }
): Promise<{ leagueId: string; userId: string } | NextResponse> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return { leagueId, userId }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const gate = await requireMember(ctx)
  if (gate instanceof NextResponse) return gate

  try {
    const [state, commissioner] = await Promise.all([
      leagueTypeState(gate.leagueId),
      isCommissioner(gate.leagueId, gate.userId),
    ])
    if (!state) return NextResponse.json({ error: 'League not found' }, { status: 404 })

    return NextResponse.json({
      ...state,
      // The UI shows the prompt to everyone and the buttons only to the person
      // who can actually act, rather than offering an action that will 403.
      canConfirm: !!commissioner,
    })
  } catch (e) {
    console.error('[league-type GET]', e)
    return NextResponse.json({ error: 'Failed to load league type' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const gate = await requireMember(ctx)
  if (gate instanceof NextResponse) return gate

  const commissioner = await isCommissioner(gate.leagueId, gate.userId)
  if (!commissioner) {
    return NextResponse.json(
      { error: 'Only the commissioner can confirm a league format' },
      { status: 403 },
    )
  }

  let body: { type?: unknown; buyIn?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.type !== 'string') {
    return NextResponse.json({ error: 'A league type is required' }, { status: 400 })
  }

  const result = await confirmLeagueType({
    leagueId: gate.leagueId,
    type: body.type,
    userId: gate.userId,
    buyIn: typeof body.buyIn === 'number' ? body.buyIn : null,
  })

  if (!result.ok) {
    const status = result.reason === 'not-found' ? 404 : result.reason === 'invalid-type' ? 400 : 500
    const message =
      result.reason === 'invalid-type'
        ? 'That is not a league format we recognise'
        : result.reason === 'not-found'
          ? 'League not found'
          : 'Could not save the league format'
    return NextResponse.json({ error: message }, { status })
  }

  return NextResponse.json({ ...result.state, canConfirm: true })
}
