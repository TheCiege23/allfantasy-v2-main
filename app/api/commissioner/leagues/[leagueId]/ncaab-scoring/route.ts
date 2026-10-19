/**
 * [NEW] GET/PUT: Commissioner NCAAB scoring config.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueNcaabScoringConfig, saveLeagueNcaabScoringConfig, getNcaabScoringPresets, buildFullNcaabScoringConfig, type NcaabScoringPresetKey } from '@/lib/ncaab-scoring'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { settingsLockedResponse } from '@/lib/league/settingsLockGuard'

const featureGate = new FeatureGateService()
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, sport: true } })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.sport !== 'NCAAB') return NextResponse.json({ error: 'NCAAB leagues only' }, { status: 400 })
  const config = await getLeagueNcaabScoringConfig(leagueId)
  let isPremium = false
  try { isPremium = (await featureGate.evaluateUserFeatureAccess(session.user.id, 'advanced_scoring')).allowed } catch {}
  return NextResponse.json({ config, presets: getNcaabScoringPresets(), isCommissioner: league.userId === session.user.id, isPremium })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, sport: true } })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.userId !== session.user.id) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  const locked = await settingsLockedResponse(leagueId, 'scoring')
  if (locked) return locked
  if (league.sport !== 'NCAAB') return NextResponse.json({ error: 'NCAAB leagues only' }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  const presetKey = (body.presetKey ?? 'af_default') as NcaabScoringPresetKey
  if ((presetKey === 'custom' || body.rules) && !(await featureGate.evaluateUserFeatureAccess(session.user.id, 'advanced_scoring').then(a => a.allowed).catch(() => false)))
    return NextResponse.json({ error: 'premiumRequired' }, { status: 403 })
  await saveLeagueNcaabScoringConfig(leagueId, { presetKey, rules: body.rules ?? buildFullNcaabScoringConfig(presetKey), userId: session.user.id, premiumFeaturesUsed: presetKey === 'custom' })
  return NextResponse.json({ ok: true, config: await getLeagueNcaabScoringConfig(leagueId) })
}
