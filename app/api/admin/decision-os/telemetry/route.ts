import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
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

/**
 * Decision OS telemetry debug surface.
 *
 * Gated by THREE independent conditions, in this order:
 *
 *  1. `isDecisionTelemetryDebugSurfaceEnabled()` — env kill switch. Returns 404
 *     (not 403) so the surface is indistinguishable from absent in production.
 *  2. `requireAdmin()` — the canonical site-admin gate, identical to every other
 *     `/api/admin` route. Yields 401 unauthenticated / 403 non-admin.
 *  3. `canAccessDecisionTelemetryDebugSurface()` — an ADDITIONAL narrowing to the
 *     dev-admin user-id allowlist.
 *
 * Why both 2 and 3, rather than either alone: they are **not the same authority**
 * and neither contains the other. `requireAdmin` keys on email / username /
 * `admin_session` cookie role (`ADMIN_EMAILS`, `ALL_ACCESS_EMAILS`,
 * `isAllFantasyTestUsername`). `canAccessDecisionTelemetryDebugSurface` delegates
 * to `isDevAdminUserId`, which keys on **user id** (`DEV_ADMIN_USER_IDS` plus two
 * hardcoded owner uuids).
 *
 * Previously this route used condition 3 ALONE, which meant anyone listed in
 * `DEV_ADMIN_USER_IDS` but in no admin email/username allowlist could read an
 * `/api/admin` endpoint while failing `requireAdmin` everywhere else. Requiring
 * both closes that divergence and is strictly a narrowing — it grants access to
 * nobody who did not already have it.
 */
export async function GET(request: NextRequest) {
  if (!isDecisionTelemetryDebugSurfaceEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const admin = await requireAdmin()
  if (!admin.ok) return admin.res

  if (!canAccessDecisionTelemetryDebugSurface(admin.user?.id)) {
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
