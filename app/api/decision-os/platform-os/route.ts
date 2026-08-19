/**
 * Fantasy OS Suite — Phase D Increment 11.
 *
 * Platform OS route: aggregates `resolvePlatformOsSnapshot` (Increment 4) over an EXPLICIT,
 * caller-supplied list of league IDs. Gated behind `authorizePlatformOsRequest` — the existing
 * internal site-admin check, not a new authorization system (see `platformOsAuthorization.ts`).
 *
 * `leagueIds` is a REQUIRED, comma-separated query param. Missing/empty → 400. This route never
 * discovers leagues on its own — the same explicit-only contract `scripts/decision-os-suite-conformance.ts`
 * already established for this same composition.
 *
 * Every successful query is recorded via the existing `logAdminAudit` (best-effort, non-blocking) so
 * there is a real accountability trail for who queried aggregate data across which leagues — this
 * route is the first Decision OS surface that can read data spanning leagues the caller does not
 * personally belong to, so an audit trail is a real, not decorative, safety measure.
 */
import { NextResponse } from 'next/server'
import { authorizePlatformOsRequest } from '@/lib/decision-os/platformOsAuthorization'
import { resolvePlatformOsSnapshot } from '@/lib/decision-os/platformOs'
import { logAdminAudit } from '@/lib/admin-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parseExplicitLeagueIds(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

export async function GET(request: Request) {
  const gate = await authorizePlatformOsRequest()
  if (!gate.authorized) {
    return NextResponse.json(
      { error: gate.status === 403 ? 'Forbidden' : 'Unauthorized' },
      { status: gate.status },
    )
  }

  const url = new URL(request.url)
  const leagueIds = parseExplicitLeagueIds(url.searchParams.get('leagueIds'))
  if (leagueIds.length === 0) {
    return NextResponse.json(
      { error: 'leagueIds is required (comma-separated). Platform OS never auto-discovers leagues.' },
      { status: 400 },
    )
  }

  const snapshot = await resolvePlatformOsSnapshot(leagueIds)

  await logAdminAudit({
    adminUserId: gate.adminUserId,
    action: 'decision_os.platform_os.query',
    targetType: 'league_ids',
    details: { leagueIds, totalMonitoredLeagues: snapshot.totalMonitoredLeagues },
  })

  return NextResponse.json(snapshot)
}
