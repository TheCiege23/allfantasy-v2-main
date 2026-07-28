/**
 * /api/leagues/import/resync
 *
 * DB-first background refresh (Launch Batch 2 · B6):
 *   POST — enqueue a durable `AutomationJob` and return 202 immediately (Sleeper); NO provider fetch on
 *          the request. A durable cron worker drains it out-of-band. Non-Sleeper providers keep the
 *          existing inline re-normalize behavior.
 *   GET  — DB-backed status the UI polls (`?provider=sleeper&sourceId=<externalLeagueId>`). Reads the
 *          latest AutomationJob + LeagueSyncState, so it is correct even after the browser navigated away.
 *
 * Status is a GET on THIS route file (not a child `/status` route) to respect the repo's Vercel route
 * budget — one route.ts, two methods.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireVerifiedUser } from '@/lib/auth-guard'
import { resolveProvider } from '@/lib/league-import/ImportProviderResolver'
import { isImportProviderAvailable } from '@/lib/league-import/provider-ui-config'
import { resyncImportedLeague } from '@/lib/league-import/resyncImportUtility'
import { prisma } from '@/lib/prisma'
import { resolveSleeperConnectionForSource } from '@/lib/fantasy-os/sync/collector'
import { enqueueSleeperRefreshJob } from '@/lib/fantasy-os/sync/refreshJob/enqueueSleeperRefreshJob'
import { SLEEPER_REFRESH_JOB_TYPE, sleeperRefreshIdempotencyPrefix } from '@/lib/fantasy-os/sync/refreshJob/constants'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const auth = await requireVerifiedUser()
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({}))
  const provider = resolveProvider(typeof body.provider === 'string' ? body.provider : '')
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : ''

  if (!provider || !sourceId) {
    return NextResponse.json({ error: 'provider and sourceId required' }, { status: 400 })
  }
  if (!isImportProviderAvailable(provider)) {
    return NextResponse.json({ error: `Import from ${provider} is not available.` }, { status: 400 })
  }

  // Sleeper → DB-first durable job: enqueue and return 202 immediately (no provider fetch on this
  // request). Duplicate clicks collapse to one job; the worker acquires the lock before any fetch.
  if (provider === 'sleeper') {
    const out = await enqueueSleeperRefreshJob({ userId: auth.userId, externalLeagueId: sourceId })
    if (!out.ok) {
      return NextResponse.json({ ok: false, error: out.error }, { status: out.httpStatus })
    }
    return NextResponse.json(
      {
        ok: true,
        jobId: out.jobId,
        leagueId: out.leagueId,
        status: out.status, // 'queued' | 'already_running' | 'up_to_date'
        lastSuccessfullyUpdated: out.lastSuccessfullyUpdated,
      },
      { status: 202 },
    )
  }

  // Non-Sleeper providers have no durable read-model collector — preserve the existing inline behavior.
  const out = await resyncImportedLeague({ userId: auth.userId, provider, sourceId })
  if (!out.ok) {
    return NextResponse.json({ ok: false, error: out.error }, { status: 400 })
  }
  return NextResponse.json({
    ok: true,
    leagueId: out.leagueId,
    runId: out.runId,
    warningCount: out.warningCount,
    reviewRequired: out.reviewRequired,
  })
}

export async function GET(req: NextRequest) {
  const auth = await requireVerifiedUser()
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const provider = resolveProvider(url.searchParams.get('provider') ?? '')
  const sourceId = (url.searchParams.get('sourceId') ?? '').trim()
  if (provider !== 'sleeper' || !sourceId) {
    return NextResponse.json({ error: 'provider=sleeper and sourceId are required' }, { status: 400 })
  }

  const resolved = await resolveSleeperConnectionForSource(auth.userId, sourceId)
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const runKey = resolved.connection.runKey

  const [job, state] = await Promise.all([
    prisma.automationJob.findFirst({
      where: {
        jobType: SLEEPER_REFRESH_JOB_TYPE,
        idempotencyKey: { startsWith: sleeperRefreshIdempotencyPrefix(runKey) },
      },
      orderBy: { createdAt: 'desc' },
      select: { status: true, metadata: true },
    }),
    prisma.leagueSyncState.findUnique({
      where: { runKey },
      select: { syncStatus: true, lastAttemptedSyncAt: true, lastSuccessfulSyncAt: true },
    }),
  ])

  const jobStatus = job?.status ?? 'idle'
  const inFlight = jobStatus === 'pending' || jobStatus === 'running'
  const jobMeta = (job?.metadata ?? {}) as Record<string, unknown>
  const changed = jobMeta.changed === true

  // Derive a UI phase from the DURABLE state (the DB is the truth, not the request that triggered it):
  // `refreshing` while a job is in flight; on completion distinguish a real update from a no-op check; a
  // failed/partial durable run reads as `failed` with the previous snapshot preserved (the runner never
  // advances freshness or erases data on failure).
  let phase: 'refreshing' | 'updated' | 'no_change' | 'failed' | 'idle'
  if (inFlight) phase = 'refreshing'
  else if (jobStatus === 'completed') phase = changed ? 'updated' : 'no_change'
  else if (jobStatus === 'failed' || state?.syncStatus === 'failed' || state?.syncStatus === 'partial') phase = 'failed'
  else phase = 'idle'

  return NextResponse.json({
    ok: true,
    phase,
    jobStatus,
    lastChecked: state?.lastAttemptedSyncAt?.toISOString() ?? null,
    lastSuccessfullyUpdated: state?.lastSuccessfulSyncAt?.toISOString() ?? null,
  })
}
