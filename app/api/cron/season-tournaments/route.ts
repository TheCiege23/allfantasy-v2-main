import { NextResponse, type NextRequest } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { runDueSeasonTournaments } from '@/lib/tournament/seasonTournamentAutomation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request, 'CRON_SECRET')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await withSyncJobRun({ jobName: 'cron-season-tournaments', trigger: 'cron' },
    () => runDueSeasonTournaments(),
    run => ({
      status: run.errors.length ? 'partial' : 'success', rowsRead: run.scanned, rowsWritten: run.advanced,
      errors: run.errors.slice(0, 10), metadata: { leagueOperations: run.processed, reportChatPosts: run.chatPosts },
    }))
  return NextResponse.json(result)
}
