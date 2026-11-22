/**
 * [NEW] GET/PUT: Commissioner MLB scoring config.
 */
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueMlbScoringConfig, getMlbScoringPresets } from '@/lib/mlb-scoring'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { resolveLeagueCategories } from '@/lib/category-scoring/leagueScoringType'
import { applySportScoringToLeague } from '@/lib/league/applySportScoring'

export const dynamic = 'force-dynamic'

const featureGate = new FeatureGateService()

export async function GET(_req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, sport: true, settings: true } })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.sport !== 'MLB') return NextResponse.json({ error: 'MLB leagues only' }, { status: 400 })
  const config = await getLeagueMlbScoringConfig(leagueId)
  const presets = getMlbScoringPresets()
  let isPremium = false
  try { isPremium = (await featureGate.evaluateUserFeatureAccess(session.user.id, 'advanced_scoring')).allowed } catch {}
  const categoryPresetId = (league.settings as Record<string, unknown>)?.category_preset_id ?? null
  // The league's own (possibly edited) category list, so the panel never shows the preset's instead.
  const categoryLabels = resolveLeagueCategories(league.settings, categoryPresetId)?.map((c) => c.label) ?? null
  return NextResponse.json({ scoringMode: (league.settings as Record<string, unknown>)?.scoring_mode ?? 'points', categoryPresetId, categoryLabels, config, presets, isCommissioner: await canCommissionerAct(leagueId, session.user.id, 'scoring'), isPremium })
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
    sport: 'MLB',
    presetKey: body.presetKey,
    rules: body.rules,
    confirmationBody: body,
    source: 'mlb-scoring',
  })
  if (!result.ok) return NextResponse.json(result.body, { status: result.status })
  return NextResponse.json({ ok: true, config: await getLeagueMlbScoringConfig(leagueId) })
}
