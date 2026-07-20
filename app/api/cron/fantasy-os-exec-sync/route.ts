import { NextResponse, type NextRequest } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { resolveCadence } from '@/lib/fantasy-os/sync/season'
import { isSyncDue } from '@/lib/fantasy-os/sync/freshness'
import { fetchLastCompletedSyncAt } from '@/lib/fantasy-os/exec-data/client'

/**
 * Fantasy OS — season-aware executive-portfolio refresh heartbeat (durable cron entrypoint).
 *
 * Deploy this on a FREQUENT fixed schedule (e.g. every 30 min). It resolves the season state, derives the
 * cadence (30 min in season / 4h offseason), and only actually syncs when the elapsed time since the last
 * COMPLETED run meets that cadence — so one fixed cron schedule yields season-aware behavior. This is the
 * durable trigger: refreshes never depend on a customer page view.
 *
 * The live incremental collector (rate-limited Sleeper fetchers + DB-backed store + leased lock, driven by
 * `lib/fantasy-os/sync/runner.runSync` with `INCREMENTAL_SCOPES`/`OFFSEASON_SCOPES`) is gated behind
 * `FANTASY_OS_EXEC_SYNC_LIVE === 'true'` so deploying this heartbeat is safe and never hammers the provider
 * until the collector is explicitly enabled in an approved environment.
 */
export const runtime = 'nodejs'
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

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (process.env.FANTASY_OS_EXEC_ENABLED !== 'true') {
    return NextResponse.json({ enabled: false, reason: 'FANTASY_OS_EXEC_ENABLED is not "true"' })
  }

  const now = new Date()
  const runKey = 'nfl:sleeper:incremental'
  const { state: seasonState, cadenceMinutes, warning } = resolveCadence({ sport: 'nfl', provider: 'sleeper', now })

  const last = await fetchLastCompletedSyncAt(runKey)
  const due = isSyncDue(last.finishedAt, cadenceMinutes, now)
  const nextEligibleAt = last.finishedAt
    ? new Date(new Date(last.finishedAt).getTime() + cadenceMinutes * 60000).toISOString()
    : now.toISOString()

  const base = {
    runKey,
    seasonState,
    cadenceMinutes,
    lastCompletedSyncAt: last.finishedAt,
    due,
    nextEligibleAt,
    ...(warning ? { warning } : {}),
  }

  if (!due) return NextResponse.json({ ...base, executed: false, reason: 'not due for this season cadence' })

  const liveEnabled = process.env.FANTASY_OS_EXEC_SYNC_LIVE === 'true'
  if (!liveEnabled) {
    // Safe default: heartbeat records the decision; the live collector is a separately-gated integration seam.
    return NextResponse.json({ ...base, executed: false, reason: 'live sync disabled (set FANTASY_OS_EXEC_SYNC_LIVE=true to enable the rate-limited collector)' })
  }

  // Integration seam: with live enabled, invoke runSync(runKey, INCREMENTAL_SCOPES|OFFSEASON_SCOPES, …) using
  // the DB-backed SyncStore + leased SyncLock + rate-limited Sleeper fetchers. Kept behind the flag so this
  // heartbeat is deployable without triggering provider load until the collector is provisioned.
  return NextResponse.json({ ...base, executed: false, reason: 'live collector not provisioned in this environment' })
}
