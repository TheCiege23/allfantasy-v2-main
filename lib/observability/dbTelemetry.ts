/**
 * Database telemetry for every Prisma operation, called from the one `$allOperations` hook in
 * `lib/prisma.ts`.
 *
 * WHY THIS EXISTS. On 2026-09-15 a 1,836ms production /core render trace held 9 spans, all of them
 * inside its first 18ms — the other ~1.8s, which is database work, left no trace at all. Across a
 * week Sentry held 350 `db` spans for the whole project. `sentry.server.config.ts` asked for
 * `prismaIntegration()`, but that file is never loaded by @sentry/nextjs 10 (only the client config
 * is injected), and on Prisma 5 the integration needs the `tracing` preview feature anyway.
 *
 * TWO LEVELS OF DETAIL, BECAUSE A SPAN PER QUERY IS UNAFFORDABLE HERE:
 *
 *  1. Every operation updates running totals on the request's ROOT span — `af.db.count`,
 *     `af.db.ms`, `af.db.max_ms`, `af.db.slowest`, `af.db.errors`. That is enough to budget
 *     database time and query count per screen, and it costs no extra spans at all.
 *  2. Only an operation slower than `slowQueryMs` becomes a real child span, created after the fact
 *     with its true start and end time, and capped per request.
 *
 * ⚠ `af.db.ms` IS DATABASE TIME, NOT WALL TIME. Queries in a `Promise.all` are summed, so it can
 * exceed the request's duration. That is the number a budget wants: it measures load put on the
 * database, which parallelising a page does not reduce.
 *
 * ⚠ TELEMETRY MUST NEVER BREAK A QUERY. Every Sentry call is inside a try; a failure costs the
 * measurement, never the result or the thrown error of the operation itself.
 */

import * as Sentry from '@sentry/nextjs'

export type DbOperation = { model?: string | null; operation: string }

type AttributeValue = string | number | boolean

export type SpanLike = {
  isRecording(): boolean
  setAttributes(attributes: Record<string, AttributeValue>): void
  setStatus(status: { code: number; message?: string }): void
  end(endTimestamp?: number): void
}

export type SpanApi = {
  getActiveSpan(): SpanLike | undefined
  getRootSpan(span: SpanLike): SpanLike
  withActiveSpan<T>(span: SpanLike, callback: () => T): T
  startInactiveSpan(options: {
    name: string
    op: string
    startTime: number
    onlyIfParent: boolean
    attributes: Record<string, AttributeValue>
  }): SpanLike
}

export type DbObserverConfig = {
  /** Operations at or above this duration get their own span. */
  slowQueryMs: number
  /** Most slow-query spans one request may create; totals keep counting past it. */
  maxSlowSpansPerRoot: number
  /** Monotonic milliseconds, for durations. */
  monotonicMs: () => number
  /** Epoch milliseconds, for span timestamps. */
  epochMs: () => number
}

type RootStats = {
  count: number
  totalMs: number
  maxMs: number
  slowest: string
  errors: number
  slowSpans: number
}

/** Sentry's status code for an errored span (OpenTelemetry `SpanStatusCode.ERROR`). */
const SPAN_STATUS_ERROR = 2

const round1 = (value: number) => Math.round(value * 10) / 10

export function operationName(operation: DbOperation): string {
  return operation.model ? `${operation.model}.${operation.operation}` : operation.operation
}

export function createDbObserver(api: SpanApi, config: DbObserverConfig) {
  // Keyed by the root span object, so a request's totals are collected when the request is.
  const statsByRoot = new WeakMap<object, RootStats>()

  function record(parent: SpanLike, operation: DbOperation, startedMonotonic: number, startedEpoch: number, failed: boolean) {
    const durationMs = Math.max(0, config.monotonicMs() - startedMonotonic)
    const root = api.getRootSpan(parent)
    // An unsampled request sends nothing, so it should cost nothing beyond the timing above.
    if (!root.isRecording()) return

    const name = operationName(operation)
    const stats = statsByRoot.get(root) ?? { count: 0, totalMs: 0, maxMs: 0, slowest: '', errors: 0, slowSpans: 0 }
    stats.count += 1
    stats.totalMs += durationMs
    if (failed) stats.errors += 1
    if (durationMs >= stats.maxMs) {
      stats.maxMs = durationMs
      stats.slowest = name
    }
    statsByRoot.set(root, stats)

    root.setAttributes({
      'af.db.count': stats.count,
      'af.db.ms': round1(stats.totalMs),
      'af.db.max_ms': round1(stats.maxMs),
      'af.db.slowest': stats.slowest,
      'af.db.errors': stats.errors,
    })

    if (durationMs < config.slowQueryMs || stats.slowSpans >= config.maxSlowSpansPerRoot) return
    stats.slowSpans += 1
    const span = api.withActiveSpan(parent, () =>
      api.startInactiveSpan({
        name,
        op: 'db.prisma',
        startTime: startedEpoch / 1000,
        onlyIfParent: true,
        attributes: {
          'db.system': 'postgresql',
          'db.operation.name': operation.operation,
          ...(operation.model ? { 'db.collection.name': operation.model } : {}),
          'af.db.slow': true,
        },
      }),
    )
    if (failed) span.setStatus({ code: SPAN_STATUS_ERROR, message: 'internal_error' })
    span.end((startedEpoch + durationMs) / 1000)
  }

  return async function observeDbOperation<T>(operation: DbOperation, run: () => Promise<T>): Promise<T> {
    let parent: SpanLike | undefined
    try {
      parent = api.getActiveSpan()
    } catch {
      parent = undefined
    }
    // No active span: not inside a traced request, a script, or Sentry is not initialised.
    if (!parent) return run()

    const startedMonotonic = config.monotonicMs()
    const startedEpoch = config.epochMs()
    let failed = false
    try {
      return await run()
    } catch (error) {
      failed = true
      throw error
    } finally {
      try {
        record(parent, operation, startedMonotonic, startedEpoch, failed)
      } catch {
        // See the header: a telemetry failure must not replace the operation's own outcome.
      }
    }
  }
}

function positiveNumberFromEnv(name: string, fallback: number): number {
  const raw = typeof process !== 'undefined' ? process.env?.[name] : undefined
  const parsed = raw == null || raw.trim() === '' ? Number.NaN : Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const sentrySpanApi: SpanApi = {
  getActiveSpan: () => Sentry.getActiveSpan() as SpanLike | undefined,
  getRootSpan: (span) => Sentry.getRootSpan(span as Parameters<typeof Sentry.getRootSpan>[0]) as SpanLike,
  withActiveSpan: (span, callback) =>
    Sentry.withActiveSpan(span as Parameters<typeof Sentry.withActiveSpan>[0], callback),
  startInactiveSpan: (options) => Sentry.startInactiveSpan(options) as SpanLike,
}

/**
 * The observer `lib/prisma.ts` uses. 100ms is "slow" for one operation now that the app and the
 * database share a region (typical reads measure in single-digit to low tens of milliseconds).
 */
export const observeDbOperation = createDbObserver(sentrySpanApi, {
  slowQueryMs: positiveNumberFromEnv('AF_TRACE_SLOW_QUERY_MS', 100),
  maxSlowSpansPerRoot: 20,
  monotonicMs: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  epochMs: () => Date.now(),
})
