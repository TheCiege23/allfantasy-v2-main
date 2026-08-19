import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { monitorLeagueHealth, LeagueHealthInputSchema } from '@/lib/league-health'
import { resolveDecisionOsLeagueHealth } from '@/lib/decision-os/leagueHealthAlignment'
import { authorizeLeagueRead } from '@/lib/decision-os/leagueReadAuthorization'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    const body = await request.json()

    // Commissioner OS Surface Alignment (Phase B Increment 3): an EXPLICIT, additive opt-in for
    // real Decision OS-backed League Health — { leagueId, source: 'decision_os' }. The legacy
    // explicit-metrics contract below is completely unchanged for every other caller.
    //
    // Phase OS-C6.1: gated by `authorizeLeagueRead` — this branch reads real Decision OS league
    // health data (found during the production-readiness audit to have no per-league membership
    // check, same gap as `/api/decision-os/mission-control`). The legacy explicit-metrics branch
    // below is untouched — it computes from caller-supplied metrics only, no league-scoped read.
    if (typeof body?.leagueId === 'string' && body?.source === 'decision_os') {
      const gate = await authorizeLeagueRead(body.leagueId, session.user.id)
      if (!gate.authorized) {
        return NextResponse.json(
          { error: gate.status === 403 ? 'Forbidden' : 'Unauthorized' },
          { status: gate.status },
        )
      }
      const result = await resolveDecisionOsLeagueHealth(body.leagueId, body.overrides ?? {})
      return NextResponse.json({ data: result })
    }

    const parsed = LeagueHealthInputSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 })
    const result = monitorLeagueHealth(parsed.data)
    return NextResponse.json({ data: result })
  } catch (err: any) {
    console.error('[league-health] POST error:', err?.message)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
