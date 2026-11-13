/**
 * Dead-letter / failure surface for background jobs when Redis/BullMQ retains failed jobs.
 * Prefer BullMQ `removeOnFail` + monitoring; this helper standardizes structured failure logs.
 */

import { logLeagueEngineEvent } from '@/lib/league-engine-performance/observability'

type DeadLetterContext = {
  queueName: string
  jobName: string
  jobId?: string
  leagueId?: string
  idempotencyKey?: string
  attempt?: number
  error: unknown
}

export function logJobDeadLetter(ctx: DeadLetterContext): void {
  const message =
    ctx.error instanceof Error ? ctx.error.message : typeof ctx.error === 'string' ? ctx.error : String(ctx.error)
  const stack = ctx.error instanceof Error ? ctx.error.stack : undefined
  logLeagueEngineEvent({
    subsystem: 'queue',
    action: 'dead_letter',
    leagueId: ctx.leagueId,
    jobId: ctx.jobId,
    idempotencyKey: ctx.idempotencyKey,
    ok: false,
    error: message,
    extra: {
      queueName: ctx.queueName,
      jobName: ctx.jobName,
      attempt: ctx.attempt,
      stack,
    },
  })
}
