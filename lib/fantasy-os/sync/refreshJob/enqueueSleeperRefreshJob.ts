/**
 * Fantasy OS — ENQUEUE a durable Sleeper current-state refresh job (Launch Batch 2 · B6, DB-first).
 *
 * The manual-resync request calls this and returns immediately — it performs NO provider fetch. It:
 *   1. resolves the caller's canonical connection + verifies access (reuses `resolveSleeperConnectionForSource`),
 *   2. enforces a soft quota (per-user in-flight cap + per-league cooldown on the LAST SUCCESSFUL sync,
 *      so a failed job never consumes the allowance),
 *   3. atomically creates or reuses ONE `AutomationJob` keyed by an idempotency bucket, so duplicate
 *      clicks collapse to a single job.
 * A durable cron worker drains the job out-of-band; the browser is never held open.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveSleeperConnectionForSource } from '@/lib/fantasy-os/sync/collector'
import {
  SLEEPER_REFRESH_JOB_TYPE,
  SLEEPER_REFRESH_COOLDOWN_MS,
  SLEEPER_REFRESH_MAX_INFLIGHT_PER_USER,
  sleeperRefreshIdempotencyKey,
  sleeperRefreshIdempotencyPrefix,
} from './constants'

export type EnqueueSleeperRefreshResult =
  | {
      ok: true
      status: 'queued' | 'already_running' | 'up_to_date'
      jobId: string | null
      leagueId: string
      runKey: string
      lastSuccessfullyUpdated: string | null
    }
  | { ok: false; httpStatus: 400 | 403 | 404 | 429; error: string }

export async function enqueueSleeperRefreshJob(input: {
  userId: string
  externalLeagueId: string
  now?: Date
}): Promise<EnqueueSleeperRefreshResult> {
  const resolved = await resolveSleeperConnectionForSource(input.userId, input.externalLeagueId)
  if (!resolved.ok) return { ok: false, httpStatus: resolved.status, error: resolved.error }

  const { connection, leagueId } = resolved
  const runKey = connection.runKey
  const nowMs = (input.now ?? new Date()).getTime()

  const state = await prisma.leagueSyncState.findUnique({
    where: { runKey },
    select: { lastSuccessfulSyncAt: true },
  })
  const lastSuccessfullyUpdated = state?.lastSuccessfulSyncAt?.toISOString() ?? null

  // (1) In-flight dedup: at most one active manual-refresh job per league at a time.
  const inflight = await prisma.automationJob.findFirst({
    where: {
      jobType: SLEEPER_REFRESH_JOB_TYPE,
      status: { in: ['pending', 'running'] },
      idempotencyKey: { startsWith: sleeperRefreshIdempotencyPrefix(runKey) },
    },
    select: { id: true },
  })
  if (inflight) {
    return { ok: true, status: 'already_running', jobId: inflight.id, leagueId, runKey, lastSuccessfullyUpdated }
  }

  // (2) Soft quota: bound concurrent manual refreshes per user. Only IN-FLIGHT jobs count, so a failed
  // or completed job never consumes the allowance.
  const userInflight = await prisma.automationJob.count({
    where: { userId: input.userId, jobType: SLEEPER_REFRESH_JOB_TYPE, status: { in: ['pending', 'running'] } },
  })
  if (userInflight >= SLEEPER_REFRESH_MAX_INFLIGHT_PER_USER) {
    return { ok: false, httpStatus: 429, error: 'Too many refreshes in progress. Please wait for them to finish.' }
  }

  // (3) Cooldown: if a SUCCESSFUL refresh happened very recently, report up-to-date instead of re-queuing.
  if (state?.lastSuccessfulSyncAt && nowMs - state.lastSuccessfulSyncAt.getTime() < SLEEPER_REFRESH_COOLDOWN_MS) {
    return { ok: true, status: 'up_to_date', jobId: null, leagueId, runKey, lastSuccessfullyUpdated }
  }

  // (4) Atomically create or reuse ONE job for this idempotency bucket.
  const idempotencyKey = sleeperRefreshIdempotencyKey(runKey, nowMs)
  try {
    const job = await prisma.automationJob.create({
      data: {
        jobType: SLEEPER_REFRESH_JOB_TYPE,
        status: 'pending',
        idempotencyKey,
        leagueId,
        userId: input.userId,
        metadata: { connection, source: 'manual-resync' } as unknown as Prisma.InputJsonValue,
        maxAttempts: 3,
      },
      select: { id: true },
    })
    return { ok: true, status: 'queued', jobId: job.id, leagueId, runKey, lastSuccessfullyUpdated }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const existing = await prisma.automationJob.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      })
      return { ok: true, status: 'already_running', jobId: existing?.id ?? null, leagueId, runKey, lastSuccessfullyUpdated }
    }
    throw e
  }
}
