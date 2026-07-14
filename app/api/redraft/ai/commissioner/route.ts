import { NextRequest, NextResponse } from 'next/server'
import {
  detectInactiveManagers,
  generateRuleRecommendations,
  moderateLeagueChat,
} from '@/lib/redraft/ai/commissionerAssistant'
import { requireAfSub } from '@/lib/redraft/ai/requireAfSub'
import { prisma } from '@/lib/prisma'
import { assertCommissioner } from '@/lib/commissioner/permissions'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const gate = await requireAfSub()
  if (gate instanceof Response) return gate
  const userId = gate

  let body: { leagueId?: string; seasonId?: string; action?: string; message?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = body.action
  if (action === 'inactive' && body.seasonId) {
    const season = await prisma.redraftSeason.findFirst({
      where: { id: body.seasonId },
      select: { leagueId: true },
    })
    if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 })
    try {
      await assertCommissioner(season.leagueId, userId)
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const alerts = await detectInactiveManagers(body.seasonId, userId)
    return NextResponse.json({ alerts })
  }
  if (action === 'rules' && body.leagueId && body.seasonId) {
    try {
      await assertCommissioner(body.leagueId, userId)
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const rules = await generateRuleRecommendations(body.leagueId, body.seasonId, userId)
    return NextResponse.json({ rules })
  }
  if (action === 'moderation' && body.message && body.leagueId) {
    try {
      await assertCommissioner(body.leagueId, userId)
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const mod = await moderateLeagueChat(body.message, body.leagueId)
    return NextResponse.json({ moderation: mod })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
