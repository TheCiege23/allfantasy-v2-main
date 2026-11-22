/**
 * [NEW] app/api/commissioner/leagues/[leagueId]/playoff-settings/route.ts
 * GET: Returns playoff config + available stages for the league's sport.
 * PUT: Updates playoff config. Premium stages require AF Commissioner Subscription.
 */

import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  getPlayoffConfig,
  savePlayoffConfig,
  getPlayoffStagesBySport,
  calculateScheduleAdjustment,
  stageEditorPlayoffStartWeek,
} from '@/lib/playoff-settings'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { settingsLockedResponse } from '@/lib/league/settingsLockGuard'

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
    select: { userId: true, sport: true, leagueVariant: true },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const refused = await commissionerAccessResponse(leagueId, session.user.id, 'view')
  if (refused) return refused

  const config = await getPlayoffConfig(leagueId)
  const stages = getPlayoffStagesBySport(league.sport)

  // Check premium access
  let isPremium = false
  try {
    const access = await featureGate.evaluateUserFeatureAccess(session.user.id, 'advanced_playoff_setup')
    isPremium = access.allowed
  } catch { isPremium = false }

  return NextResponse.json({
    config,
    stages,
    sport: league.sport,
    isPremium,
  })
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
    select: { userId: true, sport: true, leagueVariant: true, platform: true, playoffStartWeek: true, settings: true },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const refused = await commissionerAccessResponse(leagueId, session.user.id, 'league')
  if (refused) return refused

  const locked = await settingsLockedResponse(leagueId, 'playoffs')

  if (locked) return locked
  const body = await req.json().catch(() => ({}))
  const includedStages = Array.isArray(body.includedStages) ? body.includedStages as string[] : []
  const startMode = typeof body.startMode === 'string' ? body.startMode : undefined

  // Check premium access
  let isPremium = false
  try {
    const access = await featureGate.evaluateUserFeatureAccess(session.user.id, 'advanced_playoff_setup')
    isPremium = access.allowed
  } catch { isPremium = false }

  // Preview mode: return adjustment without saving
  if (body.preview === true) {
    const currentConfig = await getPlayoffConfig(leagueId)
    // Native: the preview keeps the commissioner's chosen start week (never a sport default).
    const adjustment = calculateScheduleAdjustment(league.sport, currentConfig, includedStages, league.leagueVariant, {
      playoffStartWeek: stageEditorPlayoffStartWeek(league),
    })
    return NextResponse.json({ preview: true, adjustment, isPremium })
  }

  /*
   * 🛑 POSTSEASON STAGES ARE SAVED AND NEVER PLAYED (2026-11-15). Wild Card Weekend, the NBA play-in, bowl games
   * and the rest were stored in `playoff_config_data.includedStages`, and no bracket, schedule or scorer reads it —
   * a commissioner could pay for Wild Card Weekend and the playoffs would ignore it. Until real postseason games
   * are scored, a change to the stages is refused rather than saved as if it worked. The start mode still saves.
   */
  if (Array.isArray(body.includedStages)) {
    const current = (await getPlayoffConfig(leagueId)).includedStages ?? []
    const same = includedStages.length === current.length && includedStages.every((id) => current.includes(id))
    if (!same) {
      return NextResponse.json(
        { error: 'PLAYOFF_STAGES_COMING_SOON', message: 'Real-life postseason stages are coming soon. They do not change your playoffs yet, so they cannot be turned on.' },
        { status: 409 },
      )
    }
  }

  const result = await savePlayoffConfig(leagueId, { includedStages, startMode }, { isPremium })

  if (!result.ok) {
    if (result.error === 'premiumRequired') {
      return NextResponse.json({ error: 'premiumRequired', message: 'Advanced playoff settings require AF Commissioner Subscription.' }, { status: 403 })
    }
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ ok: true, adjustment: result.adjustment, config: await getPlayoffConfig(leagueId) })
}
