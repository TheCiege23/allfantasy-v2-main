import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import {
  getTradeManagerStrategy,
  isTradeManagerStrategy,
  saveTradeManagerStrategy,
} from '@/lib/league-trade-engine/managerStrategy'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

async function authorize(leagueId: string) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return { error: NextResponse.json({ error: 'Forbidden' }, { status: gate.status }) } as const
  return { userId } as const
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params
  const auth = await authorize(leagueId)
  if ('error' in auth) return auth.error
  return NextResponse.json({ strategy: await getTradeManagerStrategy(leagueId, auth.userId) })
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params
  const auth = await authorize(leagueId)
  if ('error' in auth) return auth.error
  const body = (await req.json().catch(() => ({}))) as { active?: unknown }
  if (!isTradeManagerStrategy(body.active)) {
    return NextResponse.json({ error: 'Strategy must be win-now, balanced, or rebuild.' }, { status: 400 })
  }
  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: auth.userId },
    select: { id: true },
  }).catch(() => null)
  const strategy = await saveTradeManagerStrategy({
    leagueId,
    userId: auth.userId,
    rosterId: roster?.id ?? null,
    active: body.active,
  })
  return NextResponse.json({ strategy })
}
