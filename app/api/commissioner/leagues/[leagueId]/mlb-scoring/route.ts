/**
 * [NEW] GET/PUT: Commissioner MLB scoring config.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueMlbScoringConfig, saveLeagueMlbScoringConfig, getMlbScoringPresets, buildFullMlbScoringConfig, type MlbScoringPresetKey } from '@/lib/mlb-scoring'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'

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
  return NextResponse.json({ scoringMode: (league.settings as Record<string, unknown>)?.scoring_mode ?? 'points', categoryPresetId: (league.settings as Record<string, unknown>)?.category_preset_id ?? null, config, presets, isCommissioner: league.userId === session.user.id, isPremium })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, sport: true, settings: true } })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.userId !== session.user.id) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  if (league.sport !== 'MLB') return NextResponse.json({ error: 'MLB leagues only' }, { status: 400 })
  const scoringMode = (league.settings as Record<string, unknown>)?.scoring_mode ?? 'points'
  if (scoringMode !== 'points') return NextResponse.json({error:'This league uses category scoring; points presets cannot replace its format.'},{status:409})
  const body = await req.json().catch(() => ({}))
  const presetKey = (body.presetKey ?? 'af_default') as MlbScoringPresetKey
  const customRules = body.rules as Record<string, number> | undefined
  if (presetKey === 'custom' || customRules) {
    let isPremium = false
    try { isPremium = (await featureGate.evaluateUserFeatureAccess(session.user.id, 'advanced_scoring')).allowed } catch {}
    if (!isPremium) return NextResponse.json({ error: 'premiumRequired' }, { status: 403 })
  }
  await saveLeagueMlbScoringConfig(leagueId, { presetKey, rules: customRules ?? buildFullMlbScoringConfig(presetKey), userId: session.user.id, premiumFeaturesUsed: presetKey === 'custom' })
  return NextResponse.json({ ok: true, config: await getLeagueMlbScoringConfig(leagueId) })
}
