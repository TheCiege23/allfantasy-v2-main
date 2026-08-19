import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/get-current-user'
import {
  canAccessDecisionTelemetryDebugSurface,
  isDecisionTelemetryDebugSurfaceEnabled,
  normalizeDecisionTelemetryDebugFilters,
} from '@/lib/decision-os/core/telemetryDebugAccess'
import { listDecisionTelemetryDebugEvents } from '@/lib/decision-os/core/telemetryDebugStore'
import { emitDecisionTelemetry } from '@/lib/decision-os/core/telemetry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (!isDecisionTelemetryDebugSurfaceEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const user = await getCurrentUser()
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!canAccessDecisionTelemetryDebugSurface(user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  emitDecisionTelemetry(
    'decision.shadow_parity',
    'commissioner.league.health',
    {
      shadow: true,
      wrap_fidelity: true,
      parity_passed: true,
      decider_scope: 'commissioner',
      userId: user.id,
      leagueId: 'dev-seed',
    },
    `dev-seed-${Date.now()}`,
  )

  return NextResponse.redirect(new URL('/dev/decision-os/telemetry', request.url), 303)
}

export async function GET(request: NextRequest) {
  if (!isDecisionTelemetryDebugSurfaceEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const user = await getCurrentUser()
  if (!user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!canAccessDecisionTelemetryDebugSurface(user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const filters = normalizeDecisionTelemetryDebugFilters({
    event: request.nextUrl.searchParams.get('event'),
    decisionType: request.nextUrl.searchParams.get('decisionType'),
    userId: request.nextUrl.searchParams.get('userId'),
    leagueId: request.nextUrl.searchParams.get('leagueId'),
    decisionId: request.nextUrl.searchParams.get('decisionId'),
    limit: request.nextUrl.searchParams.get('limit'),
  })
  const events = listDecisionTelemetryDebugEvents(filters)

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    filters,
    count: events.length,
    events,
  })
}
