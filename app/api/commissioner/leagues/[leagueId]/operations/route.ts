import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { clientLeagueSettings } from '@/lib/league/clientLeagueSettings'
import { ADJUSTMENT_ERROR_TEXT } from '@/lib/score-adjustments/scoreAdjustments'
import {
  ADJUSTMENT_SERVICE_ERROR_TEXT,
  addScoreAdjustment,
  readAdjustmentWeek,
  removeScoreAdjustment,
  type AdjustmentError,
} from '@/lib/score-adjustments/scoreAdjustmentService'
import { readStatCorrections, setExtendedCorrections } from '@/lib/stat-corrections/statCorrectionService'

function adjustmentErrorResponse(error: AdjustmentError) {
  const text = (ADJUSTMENT_ERROR_TEXT as Record<string, string>)[error] ?? (ADJUSTMENT_SERVICE_ERROR_TEXT as Record<string, string>)[error] ?? 'Could not save the adjustment.'
  const status = error === 'not_found' ? 404 : error === 'not_points' || error === 'c2c' || error === 'median_only' || error === 'too_many' ? 409 : 400
  return NextResponse.json({ error: text, code: error }, { status })
}

/**
 * GET ?view=score_adjustments&week=N — one week's head-to-head matchups with their scores and the
 * commissioner's score adjustments (lib/score-adjustments). Commissioner only.
 *
 * GET ?view=stat_corrections — the latest stat-correction review of a sealed week
 * (lib/stat-corrections): which scores would change and whether a result flips. Nothing is applied.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const view = req.nextUrl.searchParams.get('view')
  if (view === 'stat_corrections') return NextResponse.json(await readStatCorrections(params.leagueId))
  if (view !== 'score_adjustments') return NextResponse.json({ error: 'Unknown view. Use: score_adjustments, stat_corrections' }, { status: 400 })
  const week = await readAdjustmentWeek(params.leagueId, req.nextUrl.searchParams.get('week'))
  if (!week) return NextResponse.json({ error: 'This league has no season schedule yet.' }, { status: 404 })
  return NextResponse.json(week)
}

/**
 * League operations: post to public dashboard, set orphan seeking, ranked visibility, orphan
 * difficulty, and add / remove a commissioner score adjustment.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const action = String(body?.action || '').toLowerCase()

  if (action === 'score_adjustment_add') {
    const r = await addScoreAdjustment(params.leagueId, userId, body)
    return r.ok ? NextResponse.json({ status: 'ok', adjustment: r.adjustment, net: r.net }) : adjustmentErrorResponse(r.error)
  }
  if (action === 'set_extended_corrections') {
    const r = await setExtendedCorrections(params.leagueId, body?.enabled)
    return r.ok ? NextResponse.json({ status: 'ok', enabled: r.enabled }) : NextResponse.json({ error: r.error }, { status: r.status })
  }
  if (action === 'score_adjustment_remove') {
    const r = await removeScoreAdjustment(params.leagueId, userId, body?.adjustmentId)
    return r.ok ? NextResponse.json({ status: 'ok', adjustment: r.adjustment, net: r.net }) : adjustmentErrorResponse(r.error)
  }

  const league = await prisma.league.findUnique({
    where: { id: params.leagueId },
    select: { settings: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const settings = (league.settings as Record<string, unknown>) || {}

  if (action === 'post_to_dashboard' || action === 'public_dashboard') {
    const value = body?.value !== false
    const updated = await prisma.league.update({
      where: { id: params.leagueId },
      data: { settings: { ...settings, publicDashboard: value } },
      select: { id: true, settings: true },
    })
    return NextResponse.json({ status: 'ok', publicDashboard: value, settings: clientLeagueSettings(updated.settings) })
  }

  if (action === 'set_orphan_seeking' || action === 'orphan_seeking') {
    const value = body?.value !== false
    const updated = await prisma.league.update({
      where: { id: params.leagueId },
      data: { settings: { ...settings, orphanSeeking: value } },
      select: { id: true, settings: true },
    })
    return NextResponse.json({ status: 'ok', orphanSeeking: value, settings: clientLeagueSettings(updated.settings) })
  }

  if (action === 'set_ranked_visibility' || action === 'ranked_visibility') {
    const value = body?.value !== false
    const updated = await prisma.league.update({
      where: { id: params.leagueId },
      data: { settings: { ...settings, rankedVisibility: value } },
      select: { id: true, settings: true },
    })
    return NextResponse.json({ status: 'ok', rankedVisibility: value, settings: clientLeagueSettings(updated.settings) })
  }

  if (action === 'update_orphan_difficulty' || action === 'orphan_difficulty') {
    const description = String(body?.description ?? body?.value ?? '')
    const updated = await prisma.league.update({
      where: { id: params.leagueId },
      data: { settings: { ...settings, orphanDifficulty: description } },
      select: { id: true, settings: true },
    })
    return NextResponse.json({ status: 'ok', orphanDifficulty: description, settings: clientLeagueSettings(updated.settings) })
  }

  return NextResponse.json({
    error: 'Invalid action. Use: post_to_dashboard, set_orphan_seeking, set_ranked_visibility, update_orphan_difficulty, score_adjustment_add, score_adjustment_remove',
  }, { status: 400 })
}
