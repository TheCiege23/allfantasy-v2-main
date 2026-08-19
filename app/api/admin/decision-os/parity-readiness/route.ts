import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { getCurrentUser } from '@/lib/get-current-user'
import {
  canAccessDecisionTelemetryDebugSurface,
  isDecisionTelemetryDebugSurfaceEnabled,
} from '@/lib/decision-os/core/telemetryDebugAccess'
import { listDecisionTelemetryDebugEvents } from '@/lib/decision-os/core/telemetryDebugStore'
import { summarizeFlipReadiness } from '@/lib/decision-os/core/parity/flipReadiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Slice 10 — flip-readiness view over decision.shadow_parity telemetry: per
// decision-type/surface comparison counts, agreement rates, skip-reason
// breakdowns, and the Phase 3 gate verdict (ready / accumulating / no_signal).
// Same double admin gate as the raw telemetry route (site-admin AND dev-admin —
// an AND, never a replacement; see that route's comment). Note: this reads the
// in-process debug ring buffer (DECISION_OS_DEBUG_TELEMETRY=true), so on
// serverless it reflects the current instance — production log drains remain
// the source of truth for full windows; this surface exists to make the shape
// of the data and gate verdicts inspectable without spelunking logs.
export async function GET(request: NextRequest) {
  if (!isDecisionTelemetryDebugSurfaceEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const user = await getCurrentUser()
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!canAccessDecisionTelemetryDebugSurface(user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const minComparisonsRaw = Number(request.nextUrl.searchParams.get('minComparisons'))
  const minAgreementRaw = Number(request.nextUrl.searchParams.get('minAgreementRate'))

  const events = listDecisionTelemetryDebugEvents({
    event: 'decision.shadow_parity',
    limit: 2000,
  })
  const summaries = summarizeFlipReadiness(events, {
    minComparisons: Number.isFinite(minComparisonsRaw) && minComparisonsRaw > 0 ? minComparisonsRaw : undefined,
    minAgreementRate:
      Number.isFinite(minAgreementRaw) && minAgreementRaw > 0 && minAgreementRaw <= 1 ? minAgreementRaw : undefined,
  })

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    eventWindow: events.length,
    surfaces: summaries,
  })
}
