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
 * MLB / NBA / NHL dynasty values. Only the bare (NFL) fire was scheduled, so the dynasty War Room had
 * no value data for any other sport. The scheduled entry is now `?sport=NFL,MLB,NBA,NHL` — the SAME
 * cron slot, recomputing one sport at a time — rather than a new entry, because main already sits
 * at the 60-cron ceiling `scripts/cron-budget-check.mjs` enforces. NFL runs first and keeps its
 * reference-capture step, so the NFL work is unchanged.
 *
 * A multi-sport fire records a heartbeat carrying each sport's errors (a table probe cannot say
 * WHICH sport wrote nothing). The name is a literal so grep finds it. A single-sport `?sport=X`
 * or bare call is unchanged and records nothing.
 */
const MULTISPORT_HEARTBEAT_JOB = 'cron-recompute-allfantasy-adp-multisport'

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

  const sports = (sportParam ? sportParam.toUpperCase() : 'NFL')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const season = seasonParam?.trim() ? seasonParam.trim() : null

  const refs = { includeTest, dryRun, includeReferences: url.searchParams.get('includeReferences') !== 'false' }
  if (sports.length > 1) return handleMultiSport({ sports, season, includeImported, ...refs })
  const sport = sports[0] ?? 'NFL'

  try {
    const { report, references, referenceErrors } = await recomputeOne({ sport, season, includeImported, ...refs })
    const hasErrors = report.errors.length > 0 || referenceErrors
    const status = hasErrors ? 207 : 200

    return NextResponse.json({ ok: !hasErrors, report, references, referenceErrors }, { status })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

type RunArgs = {
  season: string | null
  includeTest: boolean
  dryRun: boolean
  includeImported: boolean
  includeReferences: boolean
}

async function recomputeOne(args: RunArgs & { sport: string }) {
  const report = await recomputeAllFantasyAdp({
    sport: args.sport,
    season: args.season,
    draftMode: 'real',
    includeTest: args.includeTest,
    apply: !args.dryRun,
    includeImportedDrafts: args.includeImported,
  })

  let references: unknown = null
  let referenceErrors = false
  if (args.sport === 'NFL' && !args.includeTest && !args.dryRun && args.includeReferences) {
    try {
      const date = new Date(Date.now() - 86400000).toISOString().slice(0,10)
      const market = await syncMarketReferences(date, true)
      const providerAdp = await captureProviderAdp(true)
      references = { market, cached: await captureCachedReferences(true), providerAdp }
      referenceErrors = market.failed > 0 || providerAdp.unavailable
    } catch { referenceErrors = true }
  }
  return { report, references, referenceErrors }
}

/** One sport at a time, so one sport throwing still lets the others recompute. */
async function handleMultiSport(args: RunArgs & { sports: string[] }) {
  const startedAt = Date.now()
  const reports: Record<string, unknown> = {}
  const errors: string[] = []
  let rowsWritten = 0
  let failed = 0
  for (const sport of args.sports) {
    try {
      const run = await recomputeOne({ ...args, sport })
      reports[sport] = { report: run.report, references: run.references, referenceErrors: run.referenceErrors }
      rowsWritten += run.report.snapshotsWritten
      errors.push(...run.report.errors.map((e) => `${sport}: ${e}`.slice(0, 240)))
      if (run.referenceErrors) errors.push(`${sport}: reference capture failed`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      reports[sport] = { error: message }
      errors.push(`${sport}: ${message}`.slice(0, 240))
      failed++
    }
  }
  // Manual runs (dry runs, test-draft runs) must not refresh the scheduled heartbeat. A failing
  // fire still records one: it ran, and losing that would read as "never scheduled".
  if (!args.dryRun && !args.includeTest) {
    await recordHeartbeat(
      { jobName: MULTISPORT_HEARTBEAT_JOB, jobScope: args.sports.join(','), trigger: 'cron' },
      { rowsWritten, errors },
      Date.now() - startedAt,
    )
  }
  const status = failed === args.sports.length ? 500 : errors.length > 0 ? 207 : 200
  return NextResponse.json({ ok: errors.length === 0, reports }, { status })
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
