import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { getCurrentUser } from '@/lib/get-current-user'
import {
  canAccessDecisionTelemetryDebugSurface,
  isDecisionTelemetryDebugSurfaceEnabled,
  normalizeDecisionTelemetryDebugFilters,
} from '@/lib/decision-os/core/telemetryDebugAccess'
import {
  listDecisionTelemetryDebugEvents,
} from '@/lib/decision-os/core/telemetryDebugStore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!isDecisionTelemetryDebugSurfaceEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Tier-1 site-admin gate (lib/adminAuth). This is an ADDITIONAL check layered
  // ON TOP OF the tier-2 dev-admin narrowing below — an AND, never a replacement.
  // Dropping canAccessDecisionTelemetryDebugSurface and gating on requireAdmin
  // alone would WIDEN access from the ~2 owner accounts to the whole ADMIN_EMAILS
  // allowlist. Keep both.
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

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
