import { NextRequest, NextResponse } from 'next/server'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { requireDraftRouteUser } from '@/lib/draft/api-route-helpers'
import { getOrCreateDraftSession, startDraftSession } from '@/lib/live-draft-engine/DraftSessionService'
import { rosterConfigurationIncompleteBody } from '@/lib/league/roster-configuration-gate-error'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const userId = await requireDraftRouteUser()
    const body = await req.json().catch(() => ({}))
    const leagueId = String(body.leagueId ?? '').trim()
    const start = Boolean(body.start)

    if (!leagueId) {
      return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
    }

    await assertCommissioner(leagueId, userId)
    const { session, created } = await getOrCreateDraftSession(leagueId)
    if (start) {
      const started = await startDraftSession(leagueId)
      if (!started.ok) {
        if (started.reason === 'ROSTER_CONFIGURATION_INCOMPLETE') {
          return NextResponse.json(rosterConfigurationIncompleteBody({ leagueId }), { status: 409 })
        }
        if (started.reason === 'SURVIVOR_CAST_INCOMPLETE') {
          return NextResponse.json({ code: started.reason, error: started.error }, { status: 409 })
        }
        return NextResponse.json({ error: 'Could not start draft' }, { status: 400 })
      }
    }

    return NextResponse.json({
      ok: true,
      created,
      draftId: session.id,
      leagueId: session.leagueId,
      status: start ? 'in_progress' : session.status,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create draft'
    const status = message === 'Unauthorized' ? 401 : message === 'Forbidden' ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
