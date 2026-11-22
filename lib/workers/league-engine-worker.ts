import 'server-only'

import { Worker, type Job, type ConnectionOptions } from 'bullmq'
import { getRedisConnection, isRedisConfigured } from '@/lib/queues/bullmq'
import { QUEUE_NAMES } from '@/lib/jobs/types'
import type { LeagueEngineJobPayload } from '@/lib/jobs/types'
import { processWaiverClaimsForLeague } from '@/lib/waiver-wire/process-engine'
import { runScoringWorker } from '@/lib/workers/scoring-worker'
import { buildWaiverCronIdempotencyKey } from '@/lib/league-engine-performance/idempotencyKeys'
import { logJobDeadLetter } from '@/lib/league-engine-performance/deadLetter'
import { createEngineTimer, logLeagueEngineEvent } from '@/lib/league-engine-performance/observability'
import { runSpecialtyAutomationOrchestrator } from '@/lib/specialty-automation/orchestrator'
import type { AutomationTrigger } from '@/lib/specialty-automation/types'
import { IMPORT_PROVIDERS, type ImportProvider } from '@/lib/league-import/types'
import { resyncImportedLeague } from '@/lib/league-import/resyncImportUtility'
import { reprocessWeekAfterStatCorrection } from '@/server/services/statCorrectionService'
import { enqueueNotification } from '@/lib/jobs/enqueue'
import type { NotificationJobPayload } from '@/lib/jobs/types'
import { ENGINE } from '@/lib/analytics/eventNames'
import { recordEngineTelemetrySample } from '@/lib/analytics/recordAnalyticsEvent'

export type LeagueEngineWorkerResult = {
  ok: boolean
  jobId?: string
  kind: string
  processedAt: string
  detail?: Record<string, unknown>
  error?: string
}

let leagueEngineWorker: Worker<LeagueEngineJobPayload, LeagueEngineWorkerResult> | null = null

function getConnection(): ConnectionOptions {
  const connection = getRedisConnection()
  if (!connection) {
    throw new Error('Redis is not configured. League engine worker requires REDIS_URL or REDIS_HOST/REDIS_PORT.')
  }
  return connection
}

async function processLeagueEngineJob(
  job: Job<LeagueEngineJobPayload, LeagueEngineWorkerResult>,
): Promise<LeagueEngineWorkerResult> {
  const data = job.data
  const timer = createEngineTimer()
  const base = {
    jobId: job.id,
    kind: data.kind,
    processedAt: new Date().toISOString(),
  }

  const persistJobSample = (ok: boolean, extra?: Record<string, unknown>) => {
    recordEngineTelemetrySample(ENGINE.JOB, {
      meta: {
        kind: data.kind,
        leagueId: data.leagueId ?? null,
        jobId: job.id,
        durationMs: timer.elapsedMs(),
        ok,
        ...extra,
      },
    })
  }

  try {
    switch (data.kind) {
      case 'waiver_process': {
        const leagueId = data.leagueId
        if (!leagueId) throw new Error('waiver_process requires leagueId')
        const idempotencyKey = data.idempotencyKey ?? buildWaiverCronIdempotencyKey(leagueId)
        const claims = await processWaiverClaimsForLeague(leagueId, {
          idempotencyKey,
          runType: 'queue',
        })
        logLeagueEngineEvent({
          subsystem: 'waiver',
          action: 'queue_waiver_process',
          leagueId,
          durationMs: timer.elapsedMs(),
          idempotencyKey,
          jobId: job.id,
          ok: true,
          extra: { claimResults: claims.length },
        })
        persistJobSample(true, { claimResults: claims.length })
        return { ok: true, ...base, detail: { claimResults: claims.length } }
      }
      case 'scoring_week': {
        const leagueId = data.leagueId
        if (!leagueId) throw new Error('scoring_week requires leagueId')
        const season = Number(data.payload?.season)
        const weekOrRound = Number(data.payload?.weekOrRound)
        if (!Number.isFinite(season) || !Number.isFinite(weekOrRound)) {
          throw new Error('scoring_week requires payload.season and payload.weekOrRound')
        }
        const lockScores = data.payload?.lockScores === true
        await runScoringWorker({
          leagueIds: [leagueId],
          season,
          weekOrRound,
          lockScores,
        })
        logLeagueEngineEvent({
          subsystem: 'scoring',
          action: 'queue_scoring_week',
          leagueId,
          durationMs: timer.elapsedMs(),
          jobId: job.id,
          ok: true,
          extra: { season, weekOrRound },
        })
        persistJobSample(true, { season, weekOrRound })
        return { ok: true, ...base, detail: { season, weekOrRound } }
      }
      case 'standings_refresh': {
        const leagueId = data.leagueId
        if (!leagueId) throw new Error('standings_refresh requires leagueId')
        const season = Number(data.payload?.season ?? new Date().getUTCFullYear())
        const weekOrRound = Number(data.payload?.weekOrRound ?? 1)
        await runScoringWorker({ leagueIds: [leagueId], season, weekOrRound })
        persistJobSample(true, { season, weekOrRound, branch: 'standings_refresh' })
        return { ok: true, ...base, detail: { season, weekOrRound } }
      }
      case 'specialty_automation': {
        const leagueId = data.leagueId
        if (!leagueId) throw new Error('specialty_automation requires leagueId')
        const season = Number(data.payload?.season)
        const week = data.payload?.week == null ? null : Number(data.payload.week)
        const trigger = String(data.payload?.trigger ?? 'onScheduledPass') as AutomationTrigger
        if (!Number.isFinite(season)) throw new Error('specialty_automation requires payload.season')
        const out = await runSpecialtyAutomationOrchestrator({
          leagueId,
          season,
          week,
          trigger,
          force: data.payload?.force === true,
          source: 'league_engine_queue',
        })
        persistJobSample(true, { runId: out.runId, duplicate: out.duplicate, trigger })
        return { ok: true, ...base, detail: { runId: out.runId, duplicate: out.duplicate } }
      }
      case 'import_resync': {
        const userId = String(data.payload?.userId ?? '')
        const rawProvider = data.payload?.provider
        const provider =
          typeof rawProvider === 'string' && IMPORT_PROVIDERS.includes(rawProvider as ImportProvider)
            ? (rawProvider as ImportProvider)
            : null
        const sourceId = String(data.payload?.sourceId ?? '')
        if (!userId || !provider || !sourceId) {
          throw new Error('import_resync requires payload.userId, payload.provider, payload.sourceId')
        }
        const res = await resyncImportedLeague({ userId, provider, sourceId })
        if (!res.ok) {
          persistJobSample(false, { branch: 'import_resync', error: res.error })
          return { ok: false, ...base, error: res.error }
        }
        persistJobSample(true, { branch: 'import_resync', leagueId: res.leagueId, runId: res.runId })
        return { ok: true, ...base, detail: { leagueId: res.leagueId, runId: res.runId } }
      }
      case 'notification_fanout': {
        const n = data.payload?.notification as NotificationJobPayload | undefined
        if (!n?.userIds?.length || !n.title) {
          throw new Error('notification_fanout requires payload.notification (NotificationJobPayload)')
        }
        const enq = await enqueueNotification(n, { jobId: data.idempotencyKey })
        persistJobSample(enq.ok, {
          branch: 'notification_fanout',
          downstreamJobId: enq.ok ? enq.jobId : undefined,
          error: enq.ok ? undefined : enq.error,
        })
        return {
          ok: enq.ok,
          ...base,
          error: enq.ok ? undefined : enq.error,
          detail: enq.ok ? { downstreamJobId: enq.jobId } : undefined,
        }
      }
      case 'stat_correction': {
        const leagueId = data.leagueId
        if (!leagueId) throw new Error('stat_correction requires leagueId')
        const season = Number(data.payload?.season)
        const week = Number(data.payload?.week)
        if (!Number.isFinite(season) || !Number.isFinite(week)) {
          throw new Error('stat_correction requires payload.season and payload.week')
        }
        const idempotencyKey =
          data.idempotencyKey ?? `reprocess:${leagueId}:${season}:${week}:queue:${job.id ?? ''}`
        const r = await reprocessWeekAfterStatCorrection({
          leagueId,
          season,
          week,
          idempotencyKey,
          refreshPlayoffSeeds: data.payload?.refreshPlayoffSeeds !== false,
        })
        persistJobSample(true, { season, week, skipped: r.skipped })
        return { ok: true, ...base, detail: { skipped: r.skipped } }
      }
      default: {
        persistJobSample(false, { error: 'unknown_kind' })
        return { ok: false, ...base, error: `Unknown kind: ${String((data as LeagueEngineJobPayload).kind)}` }
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    recordEngineTelemetrySample(ENGINE.JOB, {
      meta: {
        kind: data.kind,
        leagueId: data.leagueId ?? null,
        jobId: job.id,
        durationMs: timer.elapsedMs(),
        ok: false,
        error: message.slice(0, 500),
      },
    })
    logJobDeadLetter({
      queueName: QUEUE_NAMES.LEAGUE_ENGINE,
      jobName: data.kind,
      jobId: job.id,
      leagueId: data.leagueId,
      idempotencyKey: data.idempotencyKey,
      attempt: job.attemptsMade,
      error: e,
    })
    return { ok: false, ...base, error: message }
  }
}

/**
 * Run one league-engine job in this process, now.
 *
 * ⚠ NOTHING CONSUMES THE LEAGUE_ENGINE QUEUE IN PRODUCTION: both Railway services run Next only and
 * nothing runs `scripts/start-worker.ts` (lib/integrity/runIntegrityJob.ts). Callers that need the
 * work done (the admin recovery buttons) run it here instead; the body is the worker's own, so the
 * telemetry and dead-letter logging are identical. Only `id`, `data` and `attemptsMade` are read.
 */
export function runLeagueEngineJobNow(data: LeagueEngineJobPayload, jobId: string): Promise<LeagueEngineWorkerResult> {
  return processLeagueEngineJob({ id: jobId, data, attemptsMade: 0 } as unknown as Job<LeagueEngineJobPayload, LeagueEngineWorkerResult>)
}

export function startLeagueEngineWorker(): Worker<LeagueEngineJobPayload, LeagueEngineWorkerResult> | null {
  if (!isRedisConfigured()) {
    console.warn('[league-engine-worker] Redis not configured. Worker disabled.')
    return null
  }

  if (leagueEngineWorker) {
    return leagueEngineWorker
  }

  leagueEngineWorker = new Worker<LeagueEngineJobPayload, LeagueEngineWorkerResult>(
    QUEUE_NAMES.LEAGUE_ENGINE,
    processLeagueEngineJob,
    {
      connection: getConnection(),
      concurrency: 4,
      limiter: { max: 20, duration: 1000 },
    },
  )

  leagueEngineWorker.on('failed', (job, err) => {
    if (!job?.data) return
    logJobDeadLetter({
      queueName: QUEUE_NAMES.LEAGUE_ENGINE,
      jobName: job.data.kind,
      jobId: job.id,
      leagueId: job.data.leagueId,
      idempotencyKey: job.data.idempotencyKey,
      attempt: job.attemptsMade,
      error: err ?? new Error('job failed'),
    })
  })

  return leagueEngineWorker
}

export async function stopLeagueEngineWorker(): Promise<void> {
  if (leagueEngineWorker) {
    await leagueEngineWorker.close()
    leagueEngineWorker = null
  }
}
