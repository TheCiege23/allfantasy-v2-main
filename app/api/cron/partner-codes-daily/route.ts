import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { isPartnerCodesEnabled } from '@/lib/partner-codes/flags'
import { runPartnerDaily } from '@/lib/partner-codes/jobs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Commissioner Partner Codes, daily: active-user days, both meters, free plans
 * (granted/renewed/removed), the cash unlock, and yearly slices coming due.
 * Off (200, skipped) unless PARTNER_CODES_ENABLED=1.
 */
async function handle(req: NextRequest) {
  if (!requireCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPartnerCodesEnabled()) return NextResponse.json({ ok: true, skipped: 'PARTNER_CODES_ENABLED is off' })
  const result = await withSyncJobRun({ jobName: 'partner-codes-daily', trigger: 'cron' }, () => runPartnerDaily(), (r) => ({ rowsRead: r.codes, rowsUpdated: r.codes, metadata: { cashUnlocked: r.cashUnlocked, slicesAccrued: r.slicesAccrued } }))
  return NextResponse.json({ ok: true, ...result })
}

export const GET = handle
export const POST = handle
