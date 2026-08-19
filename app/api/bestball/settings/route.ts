import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { requireCommissionerRole } from '@/lib/league/permissions'
import { normalizeBestBallSettings } from '@/lib/bestball/rules'
import type { LeagueSport } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    leagueId?: string
    bbWaiversEnabled?: boolean
    bbTradesEnabled?: boolean
    bbFaEnabled?: boolean
    bbIrEnabled?: boolean
    bbTaxiEnabled?: boolean
    bestBall?: Record<string, unknown>
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const leagueId = body.leagueId?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  try {
    await requireCommissionerRole(leagueId, userId)
  } catch (err) {
    if (err instanceof Response) return err
    throw err
  }

  const current = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      sport: true,
      bestBallMode: true,
      settings: true,
      bbWaiversEnabled: true,
      bbTradesEnabled: true,
      bbFaEnabled: true,
      bbIrEnabled: true,
      bbTaxiEnabled: true,
    },
  })

  if (!current) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (!current.bestBallMode) {
    return NextResponse.json({ error: 'Not a Best Ball league' }, { status: 400 })
  }

  const settingsRecord =
    current.settings && typeof current.settings === 'object' && !Array.isArray(current.settings)
      ? ({ ...(current.settings as Record<string, unknown>) } as Record<string, unknown>)
      : ({} as Record<string, unknown>)

  const existingBestBall =
    settingsRecord.best_ball_settings &&
    typeof settingsRecord.best_ball_settings === 'object' &&
    !Array.isArray(settingsRecord.best_ball_settings)
      ? (settingsRecord.best_ball_settings as Record<string, unknown>)
      : null

  const requestedDraftType =
    body.bestBall && typeof body.bestBall.draftMode === 'string'
      ? body.bestBall.draftMode
      : typeof settingsRecord.canonical_draft_mode === 'string'
        ? settingsRecord.canonical_draft_mode
        : 'snake'

  const normalizedBestBall = normalizeBestBallSettings({
    sport: current.sport as LeagueSport,
    conceptSetup: {
      bestBall: {
        ...(existingBestBall ?? {}),
        ...(body.bestBall ?? {}),
      },
    },
    draftType: requestedDraftType,
    timezone: typeof settingsRecord.timezone === 'string' ? settingsRecord.timezone : null,
    language: typeof settingsRecord.language === 'string' ? settingsRecord.language : null,
  })

  const nextWaivers =
    typeof body.bbWaiversEnabled === 'boolean' ? body.bbWaiversEnabled : normalizedBestBall.waiversEnabled
  const nextTrades =
    typeof body.bbTradesEnabled === 'boolean' ? body.bbTradesEnabled : normalizedBestBall.tradesEnabled

  if (normalizedBestBall.mode === 'underdog' && (nextWaivers || nextTrades || normalizedBestBall.substitutionsEnabled)) {
    return NextResponse.json(
      { error: 'Underdog-style Best Ball must keep waivers, trades, and manual substitutions disabled' },
      { status: 400 },
    )
  }

  const mergedSettings: Record<string, unknown> = {
    ...settingsRecord,
    canonical_draft_mode: normalizedBestBall.draftMode,
    best_ball_settings: {
      ...normalizedBestBall,
      waiversEnabled: nextWaivers,
      tradesEnabled: nextTrades,
    },
  }

  const league = await prisma.league.update({
    where: { id: leagueId },
    data: {
      bbWaiversEnabled: nextWaivers,
      bbTradesEnabled: nextTrades,
      bbFaEnabled: typeof body.bbFaEnabled === 'boolean' ? body.bbFaEnabled : nextWaivers,
      ...(typeof body.bbIrEnabled === 'boolean' ? { bbIrEnabled: body.bbIrEnabled } : {}),
      ...(typeof body.bbTaxiEnabled === 'boolean' ? { bbTaxiEnabled: body.bbTaxiEnabled } : {}),
      bbMatchupFormat: normalizedBestBall.matchupFormat,
      bbScoringPeriod: normalizedBestBall.scoringPeriod,
      bbTiebreaker: normalizedBestBall.tieRule,
      bestBallVariant: normalizedBestBall.contestStructure === 'tournament' ? 'tournament' : 'standard',
      settings: toPrismaJsonInput(mergedSettings),
    },
  })

  return NextResponse.json({ league })
}
