/**
 * Connect a scheduled job's `sync_job_runs` row to its trace.
 *
 * `sync_job_runs` already says WHEN a job ran, how long it took and what it wrote; Sentry says WHERE
 * the time went (provider calls, slow queries). Neither could point at the other, so a slow row was
 * a dead end. Recording the trace id in the row's `metadata` closes that.
 *
 * ⚠ `traceSampled: false` MEANS THERE IS NO TRACE TO OPEN. The trace id exists for every request,
 * but most job runs are deliberately not sampled (see `sampling.ts`). A reader must check the flag
 * before linking, or it links to a trace Sentry never received.
 */

import * as Sentry from '@sentry/nextjs'

export type JobTrace = { traceId: string; traceSampled: boolean }

export function annotateJobTrace(jobName: string): JobTrace | null {
  try {
    const active = Sentry.getActiveSpan()
    if (!active) return null
    const root = Sentry.getRootSpan(active)
    const traceSampled = root.isRecording()
    if (traceSampled) root.setAttributes({ 'af.sync_job': String(jobName).slice(0, 80) })
    const traceId = active.spanContext().traceId
    return typeof traceId === 'string' && /^[0-9a-f]{32}$/i.test(traceId) && !/^0+$/.test(traceId)
      ? { traceId, traceSampled }
      : null
  } catch {
    return null
  }
}

/** The trace fields to merge into a `sync_job_runs.metadata` object; empty when there is no trace. */
export function jobTraceMetadata(trace: JobTrace | null): Record<string, unknown> {
  return trace ? { traceId: trace.traceId, traceSampled: trace.traceSampled } : {}
}
