/**
 * Fantasy OS — durable WORKER handler for a Sleeper current-state refresh job (Launch Batch 2 · B6).
 *
 * Runs INSIDE the repo's existing `runAutomationJob` engine (DB-backed lifecycle, idempotency, retry,
 * observability — "safe on Vercel serverless"). The handler drives the durable collector, which acquires
 * the per-league `AutomationLock` BEFORE any provider fetch and runs the bounded current-state loader —
 * so no historical chain is traversed and no fetch happens outside the lock. Outcome mapping:
 *   - completed          → job completed (freshness advanced by the runner);
 *   - locked             → RetryableAutomationError (another executor holds the lock; retried next pass);
 *   - partial | failed   → RetryableAutomationError (runner already preserved data + withheld freshness);
 *   - invalid payload    → FatalAutomationError (never retried).
 * The durable LeagueSyncState + SyncJobRun (written by the collector) are the source of truth the status
 * endpoint reads; the AutomationJob is orchestration only.
 */
import { runAutomationJob } from '@/lib/automation/engine'
import { FatalAutomationError, RetryableAutomationError } from '@/lib/automation/errors'
import type { AutomationContext, AutomationResult } from '@/lib/automation/types'
import { syncConnectedSleeperLeague } from '@/lib/fantasy-os/sync/collector/syncConnectedSleeperLeague'
import type { SleeperSyncConnection } from '@/lib/fantasy-os/sync/collector/types'

/** Runner run-timeout for a manual refresh — bounded well under the cron's server-execution cap. */
const REFRESH_RUN_TIMEOUT_MS = 50_000

function readConnection(metadata: unknown): SleeperSyncConnection | null {
  const m = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {}
  const c = m.connection && typeof m.connection === 'object' ? (m.connection as Record<string, unknown>) : null
  if (!c) return null
  const runKey = typeof c.runKey === 'string' ? c.runKey : ''
  const externalLeagueId = typeof c.externalLeagueId === 'string' ? c.externalLeagueId : ''
  const season = typeof c.season === 'number' ? c.season : Number(c.season)
  const sport = typeof c.sport === 'string' ? c.sport : 'NFL'
  if (!runKey || !externalLeagueId || !Number.isFinite(season)) return null
  return { runKey, provider: 'sleeper', externalLeagueId, season, sport }
}

/**
 * Execute one durable Sleeper current-state refresh job. `context.idempotencyKey` must match the enqueued
 * job so the engine claims the existing pending row (rather than creating a new one).
 */
export async function runSleeperRefreshJob(
  context: AutomationContext,
): Promise<AutomationResult & { jobId: string; runId: string }> {
  return runAutomationJob(context, async (ctx): Promise<AutomationResult> => {
    const connection = readConnection(ctx.metadata)
    if (!connection) {
      // Bad job payload — never retry; there is nothing a re-run could fix.
      throw new FatalAutomationError('invalid sleeper refresh job payload (missing connection)')
    }

    const sync = await syncConnectedSleeperLeague(connection, new Date(), {
      force: true,
      runTimeoutMs: REFRESH_RUN_TIMEOUT_MS,
    })

    if (sync.status === 'completed') {
      const acc = sync.result?.accounting
      const imported = acc?.imported ?? 0
      const removed = sync.removed ?? 0
      const changed = imported > 0 || removed > 0
      return {
        status: 'completed',
        message: changed ? 'updated' : 'no_change',
        metadata: {
          runKey: connection.runKey,
          advancedFreshness: Boolean(sync.advancedFreshness),
          changed,
          imported,
          unchanged: acc?.unchanged ?? 0,
          removed,
        },
      }
    }

    if (sync.status === 'locked') {
      // Another executor holds the per-league lock — retry on the next drain pass, do NOT fail the job.
      throw new RetryableAutomationError('another refresh is already running for this league', {
        runKey: connection.runKey,
      })
    }

    // partial | failed | skipped | undefined → transient. The runner already preserved existing data and
    // withheld the freshness checkpoint; retry (bounded by maxAttempts), then settle as failed.
    throw new RetryableAutomationError(`refresh ${sync.status ?? 'incomplete'}`, {
      runKey: connection.runKey,
      status: sync.status ?? null,
    })
  })
}
