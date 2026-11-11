/**
 * GET/POST /api/cron/af-market-values
 *
 * Rebuilds the AllFantasy trade market — player values from trades that actually happened in
 * AllFantasy-connected leagues — once a day (cron-schedule.json). Reads `LeagueTrade` and the stored
 * chart, writes ONLY `AllFantasyMarketPlayerValue` + its audit table, calls no provider.
 *
 * See `lib/trade-market/scheduledMarketRecalc.ts` for why it tries the freshest window first and why a
 * refused run writes nothing.
 */
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { requireCronAuth } from '@/app/api/cron/_auth'
import { prisma } from '@/lib/prisma'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { runScheduledMarketRecalc } from '@/lib/trade-market/scheduledMarketRecalc'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Heartbeat identity in `sync_job_runs`. Must match PROBES in scripts/cron-freshness-check.mjs. */
const JOB = 'cron-af-market-values'

async function handle() {
  const startedAt = Date.now()
  try {
    const result = await withSyncJobRun(
      { jobName: JOB, trigger: 'cron' },
      () => runScheduledMarketRecalc(prisma),
      (r) => ({
        rowsWritten: r.written,
        rowsSkipped: r.written > 0 ? 0 : 1,
        /*
         * Every window refused is `partial`, not `failed`: the job did what it must (declined to
         * publish a biased population). It is not `success` either, because the market is now
         * ageing out and someone should look.
         */
        status: r.written > 0 ? ('success' as const) : ('partial' as const),
        warnings:
          r.written > 0
            ? undefined
            : [`no centred window: ${r.attempts.map((a) => `${a.sinceSeason}=${a.medianAdjustment ?? 'n/a'}%`).join(', ')}`],
      }),
    )
    return NextResponse.json({ ok: true, ...result, durationMs: Date.now() - startedAt })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/af-market-values] failed:', message.slice(0, 240))
    return NextResponse.json({ ok: false, error: message.slice(0, 240), durationMs: Date.now() - startedAt }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return handle()
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return handle()
}
