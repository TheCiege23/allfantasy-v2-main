/**
 * GET /api/admin/trade-learning/diagnostics
 *
 * Read-only. Reports the current state of the trade-learning weekly
 * recalibration system (docs/TRADE_LEARNING_SHADOW_ROLLOUT.md): whether the
 * TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED flag is on, current calibratedB0
 * and its sole owner, pending shadow value + maturity/divergence status,
 * promotion history, scheduler cadence status, and reused calibration-health
 * metrics. No write operations. Admin-authenticated only.
 */
import { NextResponse } from 'next/server'
import { requireAdminOrBearer } from '@/lib/adminAuth'
import { buildTradeLearningDiagnostics } from '@/lib/trade-engine/diagnostics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res

  const url = new URL(request.url)
  const seasonParam = url.searchParams.get('season')
  // No explicit ?season= override → let buildTradeLearningDiagnostics resolve
  // the canonical current season itself (lib/trade-engine/season-resolver.ts),
  // rather than defaulting here to a second, independent hardcoded value.
  const season = seasonParam ? Number(seasonParam) : undefined

  if (season !== undefined && !Number.isFinite(season)) {
    return NextResponse.json({ ok: false, error: 'Invalid season parameter' }, { status: 400 })
  }

  try {
    const diagnostics = await buildTradeLearningDiagnostics(season)
    return NextResponse.json({ ok: true, ...diagnostics })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message.slice(0, 240) }, { status: 500 })
  }
}
