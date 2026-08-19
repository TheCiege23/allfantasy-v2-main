import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveMissionControlSnapshot } from '@/lib/decision-os/missionControl'
import { authorizeLeagueRead } from '@/lib/decision-os/leagueReadAuthorization'
import { isSportsDataEnabled } from '@/lib/fantasy-os/sports-runtime/gates'
import { CertifiedIntelligenceIntegrationService } from '@/lib/fantasy-os/sports-runtime/intelligenceIntegration'

export const dynamic = 'force-dynamic'

/**
 * Commissioner OS Surface Alignment — Phase B Increment 5.
 *
 * Mission Control read API for one league. Mirrors `/api/decision-os/manager-intelligence`'s
 * contract exactly (session-gated, `leagueId` required, degraded-safe). Read-only.
 * `resolveMissionControlSnapshot` never throws — a pipeline failure returns an honest
 * `leagueHealth: { available: false }` snapshot, not a 500.
 *
 * Phase OS-C6.1: gated by `authorizeLeagueRead` — a real per-league membership check (commissioner/
 * co-commissioner/member/viewer), closing a real gap the production-readiness audit found: this route
 * previously allowed ANY authenticated user to read ANY league's health snapshot (including other
 * managers' retention-risk flags) given only its UUID.
 */
export async function GET(request: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const leagueId = new URL(request.url).searchParams.get('leagueId')?.trim()
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  }

  const gate = await authorizeLeagueRead(leagueId, userId)
  if (!gate.authorized) {
    return NextResponse.json(
      { error: gate.status === 403 ? 'Forbidden' : 'Unauthorized' },
      { status: gate.status },
    )
  }

  const snapshot = await resolveMissionControlSnapshot(leagueId)

  // Gated, informational certified grounding for commissioner intelligence: provider health, schedule freshness,
  // evidence coverage, delayed snapshots. It never alters commissioner recommendations or governance scoring.
  let sportsContext
  if (isSportsDataEnabled('intelligence')) {
    try {
      sportsContext = await new CertifiedIntelligenceIntegrationService().describeCommissionerSportsContext({ season: String(new Date().getFullYear()), week: '1' })
    } catch {
      sportsContext = undefined
    }
  }

  return NextResponse.json(sportsContext ? { ...snapshot, sportsContext } : snapshot)
}
