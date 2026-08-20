/**
 * SyncJobRun telemetry — standardized writer for scheduled jobs (Phase 5).
 *
 * Wrap any scheduled job body in `withSyncJobRun` and it will:
 *   1. write a `running` SyncJobRun row at start (enables the "Running" state),
 *   2. update it to `success` / `partial` / `failed` at completion with rows,
 *      duration, warnings, errors, retry count, sport, and provider,
 *   3. re-throw the original error so the route's own handling is unchanged.
 *
 * SyncJobRun has fixed columns (jobName, jobScope, trigger, status, rowsRead,
 * rowsWritten, rowsSkipped, errorMessage, durationMs, started/completedAt,
 * metadata Json). Fields without a column (sport, provider, rowsUpdated,
 * warnings, retryCount) are carried in `metadata` so nothing is lost.
 *
 * The payload mapping is a pure function (`buildSyncJobRunPayload`) so every
 * status/row/metadata branch is unit-testable without Prisma.
 */

import { prisma } from "@/lib/prisma"

export type SyncJobOutcome = {
  rowsRead?: number
  rowsWritten?: number
  rowsUpdated?: number
  rowsSkipped?: number
  warnings?: string[]
  errors?: string[]
  retryCount?: number
  /** Force a status; otherwise inferred from errors/warnings. */
  status?: "success" | "partial" | "failed"
  metadata?: Record<string, unknown>
}

export type SyncJobContext = {
  jobName: string
  jobScope?: string | null
  sport?: string | null
  provider?: string | null
  trigger?: string
}

export type SyncJobRunPayload = {
  status: "success" | "partial" | "failed"
  rowsRead: number
  rowsWritten: number
  rowsSkipped: number
  errorMessage: string | null
  durationMs: number
  metadata: Record<string, unknown>
}

function num(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function sanitize(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***").slice(0, 500)
}

/**
 * Pure: derive the completion payload from a job context, its outcome (or a
 * thrown error), and the elapsed time.
 */
export function buildSyncJobRunPayload(
  ctx: SyncJobContext,
  outcome: SyncJobOutcome | null,
  error: unknown,
  durationMs: number,
): SyncJobRunPayload {
  const warnings = outcome?.warnings ?? []
  const errors = [...(outcome?.errors ?? [])]
  if (error) {
    const message = error instanceof Error ? error.message : String(error)
    errors.push(message)
  }

  let status: "success" | "partial" | "failed"
  if (error || (outcome?.status === undefined && errors.length > 0)) {
    status = "failed"
  } else if (outcome?.status) {
    status = outcome.status
  } else if (warnings.length > 0) {
    status = "partial"
  } else {
    status = "success"
  }

  const metadata: Record<string, unknown> = {
    sport: ctx.sport ?? null,
    provider: ctx.provider ?? null,
    rowsUpdated: num(outcome?.rowsUpdated),
    warnings: warnings.slice(0, 25),
    errors: errors.slice(0, 25).map(sanitize),
    retryCount: num(outcome?.retryCount),
    ...(outcome?.metadata ?? {}),
  }

  return {
    status,
    rowsRead: num(outcome?.rowsRead),
    rowsWritten: num(outcome?.rowsWritten),
    rowsSkipped: num(outcome?.rowsSkipped),
    errorMessage: errors.length > 0 ? sanitize(errors[errors.length - 1]) : null,
    durationMs: Math.max(0, Math.round(durationMs)),
    metadata,
  }
}

type SyncJobRunModel = {
  create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>
  updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>
}

function getModel(): SyncJobRunModel | null {
  return (prisma as unknown as { syncJobRun?: SyncJobRunModel }).syncJobRun ?? null
}

/**
 * A `running` row older than this is not running — it is abandoned.
 *
 * The longest `maxDuration` any route in this repo declares is 300s, and the platform hard-kills
 * a function at that ceiling. 30 minutes is therefore ~6x the longest possible legitimate run,
 * which keeps the reaper clear of any live invocation even under heavy retry/queueing.
 */
const ABANDONED_AFTER_MS = 30 * 60_000

/**
 * Why this exists (Aug 2026): `withSyncJobRun` writes a `running` row up front and closes it in
 * its own `try/catch`. That covers a job that THROWS — but not a job that is killed. When Vercel
 * terminates a function at `maxDuration`, no user code runs afterwards: no catch, no `finally`,
 * no `finishRun`. The row stays `running` forever.
 *
 * `cron-decision-os-activity-ingest` accumulated six such rows. They are not merely untidy —
 * they actively DOWNGRADE the alarm. `computeJobHealth` in `productionHealthCore.ts` checks
 * `runningTooLong` BEFORE its freshness branches, so a permanently-`running` job reports
 * `warning` ("appears stuck") and can never escalate to the `failed` that a >210h-old last
 * success would otherwise produce. A dead job shows amber indefinitely instead of red.
 *
 * Reaping converts those rows to `failed`, which restores the normal failed/very-stale
 * escalation. Scoped to a single `jobName` so one job can never disturb another's telemetry,
 * and driven off `startedAt` so it needs no heartbeat column.
 *
 * Returns the number of rows reaped (0 when the model is unavailable or nothing was stale).
 */
export async function reapAbandonedRuns(
  jobName: string,
  options: { now?: number; abandonedAfterMs?: number } = {},
): Promise<number> {
  const model = getModel()
  if (!model || typeof model.updateMany !== "function") return 0
  const now = options.now ?? Date.now()
  const abandonedAfterMs = options.abandonedAfterMs ?? ABANDONED_AFTER_MS
  const cutoff = new Date(now - abandonedAfterMs)
  try {
    const { count } = await model.updateMany({
      where: { jobName, status: "running", startedAt: { lt: cutoff } },
      data: {
        status: "failed",
        errorMessage:
          "abandoned: run never reported a terminal status (function killed at maxDuration, or the process died). Marked failed by the stale-run reaper.",
        completedAt: new Date(now),
      },
    })
    return count ?? 0
  } catch {
    // Telemetry maintenance is best-effort — it must never break the job that triggered it.
    return 0
  }
}

/** Best-effort: write the initial `running` row. Returns its id or null. */
async function startRun(ctx: SyncJobContext): Promise<string | null> {
  const model = getModel()
  if (!model) return null
  try {
    const row = await model.create({
      data: {
        jobName: ctx.jobName,
        jobScope: ctx.jobScope ?? ctx.sport ?? null,
        trigger: ctx.trigger ?? "cron",
        status: "running",
        startedAt: new Date(),
        metadata: { sport: ctx.sport ?? null, provider: ctx.provider ?? null },
      },
    })
    return row.id
  } catch {
    return null
  }
}

async function finishRun(id: string | null, payload: SyncJobRunPayload): Promise<void> {
  const model = getModel()
  if (!model || !id) return
  try {
    await model.update({
      where: { id },
      data: {
        status: payload.status,
        rowsRead: payload.rowsRead,
        rowsWritten: payload.rowsWritten,
        rowsSkipped: payload.rowsSkipped,
        errorMessage: payload.errorMessage,
        durationMs: payload.durationMs,
        completedAt: new Date(),
        metadata: payload.metadata,
      },
    })
  } catch {
    // telemetry is best-effort; never let it break the job
  }
}

/**
 * Wrap a scheduled job so its runtime telemetry is recorded automatically.
 * `extract` maps the job's return value to row counts/warnings. The original
 * result is returned and any thrown error is re-thrown after being recorded.
 */
export async function withSyncJobRun<T>(
  ctx: SyncJobContext,
  fn: () => Promise<T>,
  extract?: (result: T) => SyncJobOutcome,
): Promise<T> {
  const startedAt = Date.now()
  // Close out any previous invocation of THIS job that was killed before it could report a
  // terminal status (see `reapAbandonedRuns`). Doing it here rather than from a dedicated route
  // means every instrumented job self-heals on its next fire — this repo sits at Vercel's
  // 2048-route ceiling, so a new maintenance endpoint is not an option. Best-effort by design:
  // a reaper failure must never stop the job from running.
  await reapAbandonedRuns(ctx.jobName)
  const id = await startRun(ctx)
  try {
    const result = await fn()
    const outcome = extract ? safeExtract(extract, result) : {}
    await finishRun(id, buildSyncJobRunPayload(ctx, outcome, null, Date.now() - startedAt))
    return result
  } catch (error) {
    await finishRun(id, buildSyncJobRunPayload(ctx, null, error, Date.now() - startedAt))
    throw error
  }
}

function safeExtract<T>(extract: (result: T) => SyncJobOutcome, result: T): SyncJobOutcome {
  try {
    return extract(result) ?? {}
  } catch {
    return {}
  }
}

/**
 * Best-effort extraction of row counts from a heterogeneous importer result.
 * Looks for common field names so routes can wrap their work in one line
 * without bespoke mapping. Unknown shapes simply record 0 rows + success.
 */
export function extractCommonCounts(result: unknown): SyncJobOutcome {
  if (!result || typeof result !== "object") return {}
  const r = result as Record<string, unknown>
  const n = (v: unknown): number | undefined => {
    const num = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
    return Number.isFinite(num) ? (num as number) : undefined
  }
  const rowsWritten =
    n(r.rowsWritten) ?? n(r.imported) ?? n(r.inserted) ?? n(r.created) ?? n(r.count) ?? n(r.processed)
  const warnings = Array.isArray(r.warnings) ? (r.warnings as unknown[]).map(String) : undefined
  const errors = Array.isArray(r.errors) ? (r.errors as unknown[]).map(String) : undefined
  return {
    rowsRead: n(r.rowsRead) ?? n(r.fetched) ?? n(r.scanned),
    rowsWritten,
    rowsUpdated: n(r.rowsUpdated) ?? n(r.updated),
    rowsSkipped: n(r.rowsSkipped) ?? n(r.skipped),
    warnings,
    errors,
  }
}

/** One-shot recorder for jobs that compute everything before writing. */
export async function recordSyncJobRun(ctx: SyncJobContext, outcome: SyncJobOutcome, durationMs: number): Promise<void> {
  const model = getModel()
  if (!model) return
  const payload = buildSyncJobRunPayload(ctx, outcome, null, durationMs)
  try {
    await model.create({
      data: {
        jobName: ctx.jobName,
        jobScope: ctx.jobScope ?? ctx.sport ?? null,
        trigger: ctx.trigger ?? "cron",
        status: payload.status,
        rowsRead: payload.rowsRead,
        rowsWritten: payload.rowsWritten,
        rowsSkipped: payload.rowsSkipped,
        errorMessage: payload.errorMessage,
        durationMs: payload.durationMs,
        startedAt: new Date(Date.now() - durationMs),
        completedAt: new Date(),
        metadata: payload.metadata,
      },
    })
  } catch {
    // best-effort
  }
}
