import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { requireCommissionerRole } from '@/lib/league/permissions'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { lockKeeperSelections, openKeeperSelectionPhase, processKeeperDeadlines } from '@/lib/keeper/selectionEngine'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'

/** Duplicated in `scripts/cron-freshness-check.mjs` PROBES — the probe reads this exact name. */
const JOB = 'cron-keeper-session'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Cron: sweep deadlines (Authorization). Users: ?leagueId= for session progress. */
export async function GET(req: NextRequest) {
  if (requireCronAuth(req, 'CRON_SECRET')) {
    /*
     * A HEARTBEAT, not an output probe, and the reason is the one this repo has hit eight times.
     * `processKeeperDeadlines` locks only sessions whose deadline has ALREADY passed, so on almost
     * every hour it correctly writes nothing and returns `{ locked: [] }`. A freshness probe on
     * KeeperSelectionSession would therefore read stale exactly when this job is healthy, and go
     * green only when a deadline happened to fall in the window — the inversion that moved the
     * other conditional jobs into PROBES as heartbeats instead of into NO_PROBE.
     *
     * ⚠ THE WRAP SPANS THE WHOLE CRON BRANCH ON PURPOSE. draft-tick was instrumented *below* its
     * own early return, so the default path recorded nothing and the job looked identical whether
     * it fired every minute or had not fired since March.
     *
     * ⚠ Cron-only. The user path below must stay uninstrumented: it is request-driven, so its
     * rows would swamp the heartbeat and make the probe meaningless.
     */
    const out = await withSyncJobRun(
      { jobName: JOB, trigger: 'cron' },
      () => processKeeperDeadlines(),
      (r) => ({ rowsWritten: r.locked.length, metadata: { locked: r.locked.length } }),
    )
    return NextResponse.json(out)
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const active = await prisma.keeperSelectionSession.findFirst({
    where: { leagueId, status: { in: ['open', 'locked'] } },
    orderBy: { openedAt: 'desc' },
  })
  return NextResponse.json({ session: active })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    leagueId?: string
    incomingSeasonId?: string
    deadline?: string
    sessionId?: string
    action?: 'open' | 'lock'
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const leagueId = body.leagueId?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  try {
    await requireCommissionerRole(leagueId, userId)
  } catch (err) {
    if (err instanceof Response) return err
    throw err
  }

  if (body.action === 'open') {
    if (!body.incomingSeasonId || !body.deadline) {
      return NextResponse.json({ error: 'incomingSeasonId and deadline required' }, { status: 400 })
    }
    const sessionRow = await openKeeperSelectionPhase(leagueId, body.incomingSeasonId, new Date(body.deadline))
    return NextResponse.json({ session: sessionRow })
  }

  if (body.action === 'lock') {
    if (!body.sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    await lockKeeperSelections(leagueId, body.sessionId)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'action must be open or lock' }, { status: 400 })
}

