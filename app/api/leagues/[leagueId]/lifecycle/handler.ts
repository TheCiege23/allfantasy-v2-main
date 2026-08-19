import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  getAllowedActions,
  loadLeagueForLifecycle,
  transitionLeagueState,
  normalizeLifecycleState,
} from '@/server/services/leagueLifecycleService'
import { isElevatedCommissioner, isHeadCommissioner } from '@/server/services/permissionService'
import type { LeagueLifecycleState } from '@prisma/client'
import { resolveLeagueAccess } from '@/lib/league-access'

export const dynamic = 'force-dynamic'

/** Align API JSON with `LeagueLifecycleSnapshot` (`allowedActions` vs internal `actions`). */
function lifecycleSnapshotJson(snap: ReturnType<typeof getAllowedActions>) {
  return {
    state: snap.state,
    locked: snap.locked,
    emergencyPaused: snap.emergencyPaused,
    allowedActions: snap.actions,
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { leagueId: string } },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveLeagueAccess(params.leagueId, userId)
  if (!access?.isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const row = await loadLeagueForLifecycle(params.leagueId)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const snap = getAllowedActions({
    lifecycleState: row.lifecycleState,
    locked: row.locked,
    emergencyPaused: row.emergencyPaused,
  })

  const [elevated, head] = await Promise.all([
    isElevatedCommissioner(params.leagueId, userId),
    isHeadCommissioner(params.leagueId, userId),
  ])

  return NextResponse.json({
    lifecycle: lifecycleSnapshotJson(snap),
    status: row.status,
    permissions: {
      isElevatedCommissioner: elevated,
      isHeadCommissioner: head,
    },
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { leagueId: string } },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const elevated = await isElevatedCommissioner(params.leagueId, userId)
  if (!elevated) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { nextState?: string; force?: boolean }
  try {
    body = (await req.json()) as { nextState?: string; force?: boolean }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const next = normalizeLifecycleState(body.nextState) as LeagueLifecycleState
  const headOnly = next === 'archived'
  if (headOnly) {
    const head = await isHeadCommissioner(params.leagueId, userId)
    if (!head) return NextResponse.json({ error: 'Only head commissioner can archive' }, { status: 403 })
  }

  const res = await transitionLeagueState(params.leagueId, next, userId, {
    force: Boolean(body.force),
  })
  if (!res.ok) {
    return NextResponse.json({ error: res.error, code: res.code }, { status: res.code === 'FORBIDDEN' ? 403 : 400 })
  }

  const snap = getAllowedActions(res.league)
  return NextResponse.json({ ok: true, league: res.league, lifecycle: lifecycleSnapshotJson(snap) })
}
