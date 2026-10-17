import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { getOrCreateDraftSession, startDraftSession, buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { transitionLeagueState } from '@/server/services/leagueLifecycleService'
import { rosterConfigurationIncompleteBody } from '@/lib/league/roster-configuration-gate-error'
import { getDraftPoolReadiness, triggerDraftPoolPrewarmBackground } from '@/lib/draft-room/ensureDraftPoolReady'

export const dynamic = 'force-dynamic'

/**
 * POST: Manually transition league from setup to drafting state and start the draft.
 * Commissioner only - useful for fixing leagues stuck in setup state.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await params

  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    // Ensure draft session exists
    const { session: draftSession } = await getOrCreateDraftSession(leagueId)
    if (!draftSession) {
      return NextResponse.json({ error: 'Failed to create draft session' }, { status: 500 })
    }

    // Transition league to pre_draft
    await transitionLeagueState(leagueId, 'pre_draft', userId)

    const poolReadiness = await getDraftPoolReadiness(leagueId)
    if (!poolReadiness.ready) {
      triggerDraftPoolPrewarmBackground(leagueId)
      return NextResponse.json(
        {
          code: 'POOL_NOT_READY',
          error: 'Preparing player pool. Try again in a few seconds.',
          poolReadiness: {
            ready: poolReadiness.ready,
            entryCount: poolReadiness.entryCount,
            source: poolReadiness.source,
            syncedAt: poolReadiness.syncedAt,
          },
        },
        { status: 409 },
      )
    }

    // Start the draft session
    const started = await startDraftSession(leagueId)
    if (!started.ok) {
      if (started.reason === 'ROSTER_CONFIGURATION_INCOMPLETE') {
        return NextResponse.json(rosterConfigurationIncompleteBody({ leagueId }), { status: 409 })
      }
      if (started.reason === 'SURVIVOR_CAST_INCOMPLETE') {
        return NextResponse.json({ code: started.reason, error: started.error }, { status: 409 })
      }
      return NextResponse.json({ error: 'Failed to start draft session' }, { status: 500 })
    }

    // Transition league to drafting
    await transitionLeagueState(leagueId, 'drafting', userId)

    // Get updated snapshot
    const snapshot = await buildSessionSnapshot(leagueId)

    return NextResponse.json({
      ok: true,
      message: 'League transitioned to drafting state successfully',
      draftSessionId: draftSession.id,
      leagueId,
      draftStatus: snapshot?.status,
    })
  } catch (e) {
    console.error('[transition-to-drafting]', e)
    return NextResponse.json(
      { error: (e as Error).message ?? 'Failed to transition league' },
      { status: 500 }
    )
  }
}
