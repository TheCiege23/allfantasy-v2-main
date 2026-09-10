import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueActivityTrend } from '@/lib/decision-os/dashboard-intelligence'
import { authorizeLeagueRead } from '@/lib/decision-os/leagueReadAuthorization'
import { retiredProfileRoute } from '@/lib/psychological-profiles/retiredProfileRoute'

export const dynamic = 'force-dynamic'

/** Preserve authenticated league activity without exposing inferred manager profiles or cached prose. */
export async function GET(request: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = new URL(request.url).searchParams.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  const gate = await authorizeLeagueRead(leagueId, userId)
  if (!gate.authorized) {
    return NextResponse.json({ error: gate.status === 403 ? 'Forbidden' : 'Unauthorized' }, { status: gate.status })
  }
  return NextResponse.json({
    managerDna: null,
    recommendations: null,
    leagueTrend: await resolveLeagueActivityTrend(leagueId),
    intelligence: {
      status: 'unsupported_scope', result: null, generatedAt: null, expiresAt: null,
      freshness: null, providerAttribution: null, orchestrationVersion: null,
      reason: 'decision_specific_evidence_required',
    },
    profileVisibility: 'private',
  }, { headers: { 'Cache-Control': 'no-store' } })
}

// Whole-profile generation cannot spend tokens or return previously generated dossiers.
export const POST = retiredProfileRoute
