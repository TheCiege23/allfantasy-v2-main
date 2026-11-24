/**
 * PROMPT 3: Commissioner — list pending overrides and resolve ambiguous mapping.
 */

import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isDevyLeague, listPendingOverrides, resolveCommissionerOverride, createCommissionerOverride } from '@/lib/devy'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const commissioner = await canCommissionerAct(leagueId, userId, 'view')
  if (!commissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const isDevy = await isDevyLeague(leagueId)
  if (!isDevy) return NextResponse.json({ error: 'Not a devy dynasty league' }, { status: 404 })

  const pending = await listPendingOverrides(leagueId)
  // Names for the commissioner's list (2026-11-23): it showed raw devy player ids.
  const ids = [...new Set(pending.map((o) => o.devyPlayerId))]
  const players = ids.length ? await prisma.devyPlayer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []
  const nameOf = new Map(players.map((p) => [p.id, p.name]))
  return NextResponse.json({ overrides: pending.map((o) => ({ ...o, playerName: nameOf.get(o.devyPlayerId) ?? null })) })
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const commissioner = await canCommissionerAct(leagueId, userId, 'league')
  if (!commissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const isDevy = await isDevyLeague(leagueId)
  if (!isDevy) return NextResponse.json({ error: 'Not a devy dynasty league' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const { action, overrideId, status, proPlayerId } = body

  if (action === 'resolve' && overrideId && (status === 'applied' || status === 'rejected')) {
    const result = await resolveCommissionerOverride({
      overrideId,
      status,
      resolvedBy: userId,
      proPlayerId,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'create' && body.devyPlayerId) {
    const created = await createCommissionerOverride({
      leagueId,
      devyPlayerId: body.devyPlayerId,
      proPlayerId: body.proPlayerId,
      action: body.overrideAction ?? 'resolve_mapping',
      notes: body.notes,
    })
    return NextResponse.json({ ok: true, overrideId: created.id })
  }

  return NextResponse.json({ error: 'Invalid action or missing params' }, { status: 400 })
}
