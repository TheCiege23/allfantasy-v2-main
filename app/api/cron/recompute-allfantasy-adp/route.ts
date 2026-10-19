/**
 * D.5-scheduler — daily AllFantasy AI ADP recompute (Neon + Prisma).
 * Vercel Cron hits `GET /api/cron/recompute-allfantasy-adp` (see `vercel.json`).
 * Auth: `requireCronAuth` (`CRON_SECRET`, `X-Cron-Secret`, or Bearer).
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { recomputeAllFantasyAdp } from '@/lib/adp/recomputeAllFantasyAdp'
import { syncMarketReferences, captureCachedReferences, captureProviderAdp } from '@/lib/draft-archive/ingestion/referenceWriter'
import { recordSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'

/*
 * MLB / NBA / NHL dynasty values. The bare (NFL) fire was the only one scheduled, so the dynasty
 * War Room had no value data for any other sport. Those three fire as `?sport=X` modes of this
 * route and share `allfantasy_adp_snapshots.lastUpdatedAt` with the NFL fire — a table probe on
 * them would be satisfied by NFL — so each records its own heartbeat. Names are literals so
 * `__tests__/cron-heartbeat-route-contracts.test.ts` and grep can find them; keep them in step
 * with PROBES in scripts/cron-freshness-check.mjs.
 */
const HEARTBEAT_JOB_BY_SPORT: Record<string, string> = {
  MLB: 'cron-recompute-allfantasy-adp-mlb',
  NBA: 'cron-recompute-allfantasy-adp-nba',
  NHL: 'cron-recompute-allfantasy-adp-nhl',
}

/** Telemetry must never turn a finished recompute into a 500. */
async function recordHeartbeat(...args: Parameters<typeof recordSyncJobRun>): Promise<void> {
  try {
    await recordSyncJobRun(...args)
  } catch (err) {
    console.warn('[recompute-allfantasy-adp] heartbeat not recorded:', err instanceof Error ? err.message : String(err))
  }
}

/**
 * NOTE: `requireCronAuth` resolves `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`.
 * Vercel Cron presents `Authorization: Bearer $CRON_SECRET`, so a BARE call checks
 * LEAGUE_CRON_SECRET first and 401s whenever that variable is set to anything else — which is
 * what happened in production the moment #284 made these routes reachable again (404 -> 401,
 * measured 2026-07-20 00:01 UTC). Naming CRON_SECRET explicitly is what `keeper/session` and
 * `weather/refresh-cron` already do, and those are the crons that were returning 200.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function handle(req: NextRequest) {
  // Vitest passes a standard `Request` (no `nextUrl`); production uses `NextRequest` — both expose `url`.
  const url = new URL(req.url)
  const includeTest = url.searchParams.get('includeTest') === 'true'
  const dryRun = url.searchParams.get('dryRun') === 'true'
  const sportParam = url.searchParams.get('sport')
  const seasonParam = url.searchParams.get('season')
  /*
   * Ops kill switch for the imported-draft pass (lib/adp/draftFactSamples.ts). Default ON - those
   * facts are the largest body of real picks we hold and reached nothing before. `?includeImported=false`
   * turns them off WITHOUT A DEPLOY if the pass ever misbehaves in production; the CLI has the same
   * control, but the CLI is not what runs at 09:00.
   */
  const includeImported = url.searchParams.get('includeImported') !== 'false'

  const sport = sportParam ? sportParam.toUpperCase() : 'NFL'
  const season = seasonParam?.trim() ? seasonParam.trim() : null
  // Manual runs (dry runs, test-draft runs) must not refresh the scheduled heartbeat.
  const heartbeatJob = !dryRun && !includeTest ? HEARTBEAT_JOB_BY_SPORT[sport] ?? null : null
  const startedAt = Date.now()

  try {
    const report = await recomputeAllFantasyAdp({
      sport,
      season,
      draftMode: 'real',
      includeTest,
      apply: !dryRun,
      includeImportedDrafts: includeImported,
    })

    let references: unknown = null
    let referenceErrors = false
    if (sport === 'NFL' && !includeTest && !dryRun && url.searchParams.get('includeReferences') !== 'false') {
      try {
        const date = new Date(Date.now() - 86400000).toISOString().slice(0,10)
        const market = await syncMarketReferences(date, true)
        const providerAdp = await captureProviderAdp(true)
        references = { market, cached: await captureCachedReferences(true), providerAdp }
        referenceErrors = market.failed > 0 || providerAdp.unavailable
      } catch { referenceErrors = true }
    }
    const hasErrors = report.errors.length > 0 || referenceErrors
    const status = hasErrors ? 207 : 200
    if (heartbeatJob) {
      await recordHeartbeat(
        { jobName: heartbeatJob, sport, trigger: 'cron' },
        { rowsWritten: report.snapshotsWritten, errors: report.errors.map((e) => e.slice(0, 240)) },
        Date.now() - startedAt,
      )
    }

    return NextResponse.json({ ok: !hasErrors, report, references, referenceErrors }, { status })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // A failing fire is still a fire that ran; losing the heartbeat would read as "never scheduled".
    if (heartbeatJob) {
      await recordHeartbeat({ jobName: heartbeatJob, sport, trigger: 'cron' }, { errors: [message.slice(0, 240)] }, Date.now() - startedAt)
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return handle(req)
}
