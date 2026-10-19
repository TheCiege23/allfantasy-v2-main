/**
 * [NEW] GET/PUT: Commissioner Soccer scoring config.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueSoccerScoringConfig, saveLeagueSoccerScoringConfig, getSoccerScoringPresets, buildFullSoccerScoringConfig, type SoccerScoringPresetKey } from '@/lib/soccer-scoring'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { decideSettingsEdit, recordMidSeasonSettingsChange } from '@/lib/league/settingsLifecycleGate'

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
  return NextResponse.json({ config, presets: getSoccerScoringPresets(), isCommissioner: league.userId === session.user.id, isPremium })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, sport: true } })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.userId !== session.user.id) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  if (league.sport !== 'SOCCER') return NextResponse.json({ error: 'Soccer leagues only' }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  const lifecycle = await decideSettingsEdit(leagueId, session.user.id, 'scoring', body)
  if (!lifecycle.ok) return NextResponse.json(lifecycle.body, { status: lifecycle.status })
  const presetKey = (body.presetKey ?? 'af_default') as SoccerScoringPresetKey
  if ((presetKey === 'custom' || body.rules) && !(await featureGate.evaluateUserFeatureAccess(session.user.id, 'advanced_scoring').then(a => a.allowed).catch(() => false)))
    return NextResponse.json({ error: 'premiumRequired' }, { status: 403 })
  await saveLeagueSoccerScoringConfig(leagueId, { presetKey, rules: body.rules ?? buildFullSoccerScoringConfig(presetKey), userId: session.user.id, premiumFeaturesUsed: presetKey === 'custom' })
  await recordMidSeasonSettingsChange(lifecycle, { leagueId: leagueId, userId: session.user.id, section: 'scoring', source: 'soccer-scoring', detail: { presetKey } })
  return NextResponse.json({ ok: true, config: await getLeagueSoccerScoringConfig(leagueId) })
}
