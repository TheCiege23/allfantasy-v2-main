import { NextRequest, NextResponse } from 'next/server'
import {
  detectInactiveManagers,
  generateRuleRecommendations,
  moderateLeagueChat,
} from '@/lib/redraft/ai/commissionerAssistant'
import { requireAfSub } from '@/lib/redraft/ai/requireAfSub'
import { prisma } from '@/lib/prisma'
import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const gate = await requireAfSub()
  if (gate instanceof Response) return gate

  let body: { leagueId?: string; seasonId?: string; action?: string; message?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = body.action
  /*
   * 🛑 THIS CHECKED ONLY THE SUBSCRIPTION, NOT THE LEAGUE (2026-11-16): any subscriber could read any league's inactive
   * managers and chat moderation by naming its season or league. It is a commissioner tool for the league named — the
   * season's own league, and the league in the body must be that one.
   */
  const season = body.seasonId
    ? await prisma.redraftSeason.findUnique({ where: { id: body.seasonId }, select: { leagueId: true } })
    : null
  if (body.seasonId && !season) return NextResponse.json({ error: 'Season not found' }, { status: 404 })
  if (season && body.leagueId && season.leagueId !== body.leagueId) {
    return NextResponse.json({ error: 'That season is not in this league' }, { status: 400 })
  }
  const leagueId = season?.leagueId ?? body.leagueId
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const refused = await commissionerAccessResponse(leagueId, gate, action === 'moderation' ? 'chat' : 'league')
  if (refused) return refused

  if (action === 'inactive' && body.seasonId) {
    const alerts = await detectInactiveManagers(body.seasonId)
    return NextResponse.json({ alerts })
  }
  if (action === 'rules' && body.leagueId && body.seasonId) {
    const rules = await generateRuleRecommendations(body.leagueId, body.seasonId)
    return NextResponse.json({ rules })
  }
  if (action === 'moderation' && body.message && body.leagueId) {
    const mod = await moderateLeagueChat(body.message, body.leagueId)
    return NextResponse.json({ moderation: mod })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
