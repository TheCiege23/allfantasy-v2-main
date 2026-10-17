import { nativeCategoryScoringContext } from '@/lib/category-scoring/nativeCategoryScoringContext'
/**
 * [NEW] app/api/commissioner/leagues/[leagueId]/nba-scoring/route.ts
 * GET: Returns NBA scoring config + available presets.
 * PUT: Updates NBA scoring config. Advanced editing requires AF Commissioner sub.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  getLeagueNbaScoringConfig,
  saveLeagueNbaScoringConfig,
  getNbaScoringPresets,
  buildFullScoringConfig,
  type NbaScoringPresetKey,
} from '@/lib/nba-scoring'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'

const featureGate = new FeatureGateService()

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await params
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, sport: true, settings: true },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.sport !== 'NBA') return NextResponse.json({ error: 'NBA leagues only' }, { status: 400 })

  const config = await getLeagueNbaScoringConfig(leagueId)
  const presets = getNbaScoringPresets()
  const isCommissioner = league.userId === session.user.id

  let isPremium = false
  try {
    const access = await featureGate.evaluateUserFeatureAccess(session.user.id, 'advanced_scoring')
    isPremium = access.allowed
  } catch { isPremium = false }

  return NextResponse.json({ config, presets, isCommissioner, isPremium, categoryScoring: nativeCategoryScoringContext(league.settings, 'NBA') })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await params
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, sport: true, settings: true },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.userId !== session.user.id) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  if (league.sport !== 'NBA') return NextResponse.json({ error: 'NBA leagues only' }, { status: 400 })

  if (nativeCategoryScoringContext(league.settings, 'NBA')) return NextResponse.json({ error: 'This league uses categories; point weights do not apply.' }, { status: 409 })

  const body = await req.json().catch(() => ({}))
  const presetKey = (body.presetKey ?? 'af_default') as NbaScoringPresetKey
  const customRules = body.rules as Record<string, number> | undefined

  // If custom editing, check premium access
  if (presetKey === 'custom' || customRules) {
    let isPremium = false
    try {
      const access = await featureGate.evaluateUserFeatureAccess(session.user.id, 'advanced_scoring')
      isPremium = access.allowed
    } catch { isPremium = false }
    if (!isPremium) {
      return NextResponse.json({ error: 'premiumRequired', message: 'Custom scoring editing requires AF Commissioner Subscription.' }, { status: 403 })
    }
  }

  const rules = customRules ?? buildFullScoringConfig(presetKey)

  await saveLeagueNbaScoringConfig(leagueId, {
    presetKey,
    rules,
    userId: session.user.id,
    premiumFeaturesUsed: presetKey === 'custom',
  })

  const updated = await getLeagueNbaScoringConfig(leagueId)
  return NextResponse.json({ ok: true, config: updated })
}
