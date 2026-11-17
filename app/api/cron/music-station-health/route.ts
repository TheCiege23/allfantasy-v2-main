/**
 * GET/POST /api/cron/music-station-health — weekly check of the Music tab's YouTube stations.
 *
 * Schedule: Mondays 11:00 UTC (cron-schedule.json), an expression the slow-tier workflow
 * already fires, so no workflow change was needed.
 *
 * Emails the owner ONLY when a station is broken or stale, or when the check itself
 * cannot run (no YouTube key on this service). A quiet week sends nothing; the
 * heartbeat row in sync_job_runs is the record that it ran.
 *
 * The station rules and what the check can and cannot see: lib/app-music/stationHealth.ts.
 */
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { checkStations, needsAttention, summarize, youtubeGet } from '@/lib/app-music/stationHealth'
import { OWNER_EMAIL } from '@/lib/notifications/notifyOwnerOfNewSignup'
import { sendNotificationEmail } from '@/lib/resend-client'

export const dynamic = 'force-dynamic'

/** Heartbeat identity. Must match PROBES in scripts/cron-freshness-check.mjs. */
const JOB = 'cron-music-station-health'

async function email(subject: string, body: string) {
  try {
    await sendNotificationEmail({ to: OWNER_EMAIL, subject, bodyHtml: body })
  } catch (err) {
    console.warn('[cron/music-station-health] email failed:', err instanceof Error ? err.message : 'unknown')
  }
}

async function handle() {
  const startedAt = Date.now()
  const apiKey = process.env.YOUTUBE_API_KEY?.trim()

  try {
    const result = await withSyncJobRun(
      { jobName: JOB, trigger: 'cron' },
      async () => {
        if (!apiKey) {
          // Say so loudly: a check that silently skips is the failure this job exists to prevent.
          await email(
            'Music station check could not run',
            'The weekly music station check needs YOUTUBE_API_KEY on the service that runs crons (allfantasy-v2-worker), and it is not set there. Nothing was checked.',
          )
          return { ran: false as const }
        }
        const checks = await checkStations(youtubeGet(apiKey))
        const attention = needsAttention(checks)
        if (attention.length > 0) {
          const lines = attention.map((c, i) => `${i + 1}. ${c.label} (${c.status}): ${c.detail}`)
          await email(
            `Music stations: ${attention.length} need a look`,
            `The weekly music station check found ${attention.length} of ${checks.length} stations that need a look. ${lines.join(' ')} Fix by swapping the station's playlist in lib/draft-music/youtube.ts.`,
          )
        }
        return { ran: true as const, checks, attention }
      },
      (r) =>
        r.ran
          ? {
              rowsWritten: r.checks.length,
              rowsSkipped: summarize(r.checks).unchecked,
              status: r.attention.length > 0 ? ('partial' as const) : ('success' as const),
              warnings: r.attention.map((c) => `${c.id}: ${c.status} — ${c.detail}`).slice(0, 20),
            }
          : { rowsWritten: 0, rowsSkipped: 0, status: 'failed' as const, warnings: ['YOUTUBE_API_KEY not set'] },
    )

    return NextResponse.json({
      ok: result.ran,
      ...(result.ran
        ? { summary: summarize(result.checks), stations: result.checks }
        : { error: 'YOUTUBE_API_KEY not set' }),
      durationMs: Date.now() - startedAt,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron/music-station-health] failed:', message)
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
