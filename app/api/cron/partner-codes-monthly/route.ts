import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { isPartnerCodesEnabled } from '@/lib/partner-codes/flags'
import { runPartnerMonthly } from '@/lib/partner-codes/jobs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Commissioner Partner Codes, 1st of the month: last month's statements, each
 * `pending_review` (or `held` with no W-9). No money moves — an admin approves
 * and marks each one paid at /admin/partner-codes. Safe to re-run: one statement
 * per code per month.
 */
async function handle(req: NextRequest) {
  if (!requireCronAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPartnerCodesEnabled()) return NextResponse.json({ ok: true, skipped: 'PARTNER_CODES_ENABLED is off' })
  const result = await withSyncJobRun({ jobName: 'partner-codes-monthly', trigger: 'cron' }, () => runPartnerMonthly(), (r) => ({ rowsWritten: r.created, metadata: { periodMonth: r.periodMonth, held: r.held, rolledOver: r.rolledOver } }))
  return NextResponse.json({ ok: true, ...result })
}

export const GET = handle
export const POST = handle
