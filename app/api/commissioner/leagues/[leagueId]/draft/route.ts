import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { rosterConfigurationIncompleteBody } from '@/lib/league/roster-configuration-gate-error'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { getLeagueDrafts, getDraftPicks } from '@/lib/sleeper-client'

/** GET: Draft state from platform (Sleeper). Read-only; use for live draft display. */
export async function GET(_req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const league = await prisma.league.findUnique({
    where: { id: params.leagueId },
    select: { platform: true, platformLeagueId: true },
  })
  if (!league || league.platform !== 'sleeper') {
    return NextResponse.json({
      platformSupported: false,
      message: 'Draft state is only available for Sleeper leagues.',
    })
  }

  try {
    const drafts = await getLeagueDrafts(league.platformLeagueId)
    const latest = Array.isArray(drafts) && drafts.length > 0 ? drafts[drafts.length - 1] : null
    if (!latest || !latest.draft_id) {
      return NextResponse.json({
        platformSupported: true,
        draftStatus: null,
        draftId: null,
        picks: [],
        message: 'No draft found for this league.',
      })
    }
    const picks = await getDraftPicks(latest.draft_id)
    return NextResponse.json({
      platformSupported: true,
      draftStatus: latest.status ?? null,
      draftId: latest.draft_id,
      draft: latest,
      picks: picks ?? [],
    })
  } catch (err) {
    return NextResponse.json({
      platformSupported: true,
      error: 'Failed to fetch draft state',
      message: (err as Error)?.message,
    }, { status: 502 })
  }
}

/** Draft controls: pause, resume, reset_timer, undo_pick, assign_pick.
 * When AllFantasy live draft session exists, delegates to live-draft-engine. Otherwise returns stub for Sleeper.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const action = String(body?.action || '').toLowerCase()

  const supported = ['pause', 'resume', 'reset_timer', 'undo_pick', 'assign_pick', 'reorder']
  if (!supported.includes(action)) {
    return NextResponse.json({ error: `Invalid action. Use one of: ${supported.join(', ')}` }, { status: 400 })
  }

  const {
    getDraftSessionByLeague,
    pauseDraftSession,
    resumeDraftSession,
    resetTimer,
    undoLastPick,
    buildSessionSnapshot,
  } = await import('@/lib/live-draft-engine/DraftSessionService')
  const { submitPick } = await import('@/lib/live-draft-engine/PickSubmissionService')
  const draftSession = await getDraftSessionByLeague(params.leagueId)
  if (draftSession && draftSession.status !== 'pre_draft') {
    try {
      if (action === 'pause') {
        const ok = await pauseDraftSession(params.leagueId, userId)
        if (!ok) return NextResponse.json({ error: 'Cannot pause', platformSupported: true }, { status: 400 })
        const session = await buildSessionSnapshot(params.leagueId)
        return NextResponse.json({ status: 'acknowledged', action, platformSupported: true, session })
      }
      if (action === 'resume') {
        const ok = await resumeDraftSession(params.leagueId)
        if (!ok) return NextResponse.json({ error: 'Cannot resume', platformSupported: true }, { status: 400 })
        const session = await buildSessionSnapshot(params.leagueId)
        return NextResponse.json({ status: 'acknowledged', action, platformSupported: true, session })
      }
      if (action === 'reset_timer') {
        const ok = await resetTimer(params.leagueId)
        if (!ok) return NextResponse.json({ error: 'Cannot reset timer', platformSupported: true }, { status: 400 })
        const session = await buildSessionSnapshot(params.leagueId)
        return NextResponse.json({ status: 'acknowledged', action, platformSupported: true, session })
      }
      if (action === 'undo_pick') {
        const ok = await undoLastPick(params.leagueId)
        if (!ok) return NextResponse.json({ error: 'No pick to undo', platformSupported: true }, { status: 400 })
        const session = await buildSessionSnapshot(params.leagueId)
        return NextResponse.json({ status: 'acknowledged', action, platformSupported: true, session })
      }
      if (action === 'assign_pick') {
        const playerName = body.playerName ?? body.player_name
        const position = body.position ?? ''
        if (!playerName || !position) {
          return NextResponse.json({ error: 'assign_pick requires playerName and position', platformSupported: true }, { status: 400 })
        }
        const result = await submitPick({
          leagueId: params.leagueId,
          playerName: String(playerName).trim(),
          position: String(position).trim(),
          team: body.team ?? null,
          byeWeek: body.byeWeek ?? null,
          rosterId: body.rosterId ?? undefined,
          source: 'commissioner',
        })
        if (!result.success) {
          const status = result.code === 'ROSTER_CONFIGURATION_INCOMPLETE' ? 409 : 400
          if (result.code === 'ROSTER_CONFIGURATION_INCOMPLETE') {
            return NextResponse.json(
              {
                ...rosterConfigurationIncompleteBody({ leagueId: params.leagueId, message: result.error }),
                platformSupported: true,
              },
              { status },
            )
          }
          return NextResponse.json({ error: result.error, platformSupported: true }, { status })
        }
        const session = await buildSessionSnapshot(params.leagueId)
        return NextResponse.json({ status: 'acknowledged', action: 'assign_pick', platformSupported: true, session })
      }
      if (action === 'reorder') {
        return NextResponse.json({ status: 'acknowledged', action, message: 'Reorder not yet implemented', platformSupported: true })
      }
    } catch (e) {
      console.error('[commissioner/draft POST]', e)
      return NextResponse.json({ error: (e as Error)?.message, platformSupported: true }, { status: 500 })
    }
  }

  return NextResponse.json({
    status: 'acknowledged',
    action,
    message: 'No active AllFantasy draft session. Create one at /api/leagues/[leagueId]/draft/session (POST action=start). Sleeper draft controls are read-only.',
    platformSupported: false,
  })
}
