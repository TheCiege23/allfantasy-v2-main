/**
 * [NEW] GET/PUT: Commissioner Soccer scoring config.
 */
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueSoccerScoringConfig, getSoccerScoringPresets } from '@/lib/soccer-scoring'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { applySportScoringToLeague } from '@/lib/league/applySportScoring'

const featureGate = new FeatureGateService()
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, sport: true } })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.sport !== 'SOCCER') return NextResponse.json({ error: 'Soccer leagues only' }, { status: 400 })
  const config = await getLeagueSoccerScoringConfig(leagueId)
  let isPremium = false
  try { isPremium = (await featureGate.evaluateUserFeatureAccess(session.user.id, 'advanced_scoring')).allowed } catch {}
  return NextResponse.json({ config, presets: getSoccerScoringPresets(), isCommissioner: await canCommissionerAct(leagueId, session.user.id, 'scoring'), isPremium })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const body = (await req.json().catch(() => ({}))) as { presetKey?: string; rules?: Record<string, number> }
  // The commissioner check, settings lock, format guard, season-phase gate, premium gate, save and league log all
  // live in applySportScoringToLeague, which shared scoring uses too, so the two can never disagree.
  const result = await applySportScoringToLeague({
    leagueId,
    userId: session.user.id,
    sport: 'SOCCER',
    presetKey: body.presetKey,
    rules: body.rules,
    confirmationBody: body,
    source: 'soccer-scoring',
  })
  if (!result.ok) return NextResponse.json(result.body, { status: result.status })
  return NextResponse.json({ ok: true, config: await getLeagueSoccerScoringConfig(leagueId) })
}
