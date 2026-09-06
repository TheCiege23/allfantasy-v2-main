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
import { redactAndCap } from "@/lib/security/redactSecrets"

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

/**
 * Everything written to `errorMessage` and to `metadata.errors` goes through here.
 *
 * This used to strip only `sk-` keys, which is the wrong half of the problem for this repo:
 * Rolling Insights passes `RSC_token` as a QUERY PARAMETER and TheSportsDB puts its key in a URL
 * PATH SEGMENT, so any provider error carrying a URL landed here verbatim. That matters more now
 * that routes deliberately pass their full error detail in — `cron/waivers` redacts its HTTP
 * response to "discovery_failed" in production but hands the real message to telemetry.
 *
 * Redaction happens before the length cap, never after: slicing first can cut a secret in half
 * and leave the front of it readable.
 */
function sanitize(text: string): string {
  return redactAndCap(text, 500)
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
 * 🛑 A LOST TELEMETRY WRITE USED TO BE COMPLETELY INVISIBLE, AND THE MONITOR BUILT ON IT WAS NOT.
 *
 * Every path in this module was best-effort — `if (!model) return` and a bare `catch {}` — which is
 * correct as BEHAVIOUR (telemetry must never fail the job it observes) and was wrong as SILENCE.
 * When a row does not arrive, `scripts/cron-freshness-check.mjs` reports CONFIG, "no sync_job_runs
 * rows for job_name X", which reads as a registry mistake rather than a write that failed.
 *
 * Measured on production 2026-09-06, from the slow-tier dispatcher log against the table:
 *
 *     06:09  import-news?xnews=1 ... OK 200 ( 78900ms)   ->  no row
 *     12:07  import-news?xnews=1 ... OK 200 (251446ms)   ->  no row
 *     18:21  import-news?xnews=1 ... OK 200 (215529ms)   ->  row written
 *     09:07  sync-player-images?sport=NFL   OK 200       ->  no row
 *     09:20  sync-player-images?sport=NCAAF OK 200       ->  no row
 *
 * The jobs ran, returned 200, and left no trace. "Not deployed" was ruled out — all eleven of that
 * day's deployments contain the commit that added the instrumentation.
 *
 * ⚠ THE TWO FAILURE PATHS ARE INDISTINGUISHABLE FROM OUTSIDE, WHICH IS THE ACTUAL PROBLEM.
 * A missing `prisma.syncJobRun` delegate and a `create` that threw produce the identical outcome —
 * no row, no error, exit 200. Naming which one fired is the whole point of this helper.
 *
 * ⚠ IT DOES NOT CHANGE BEHAVIOUR. Nothing throws, nothing is retried, every caller still returns
 * exactly what it returned before. The only difference is a line in the logs.
 *
 * 🛑 AND THE MESSAGE GOES THROUGH `redactAndCap`, NOT A BARE `slice`. A Prisma connection error
 * carries the database URL, and this repo is PUBLIC with its logs pasted into issues — the
 * keystore-password and RSC_token entries in CLAUDE.md are both secrets escaping through an ERROR
 * path, which is exactly what this function is. The first draft of it sliced to 160 and would have
 * shipped that; `sanitize` above already states the rule this broke — redact BEFORE capping,
 * because slicing first can cut a credential in half and leave the readable front of it in the log.
 */
function reportTelemetryLoss(where: string, ctx: SyncJobContext, reason: unknown): void {
  const detail =
    reason === undefined
      ? "prisma.syncJobRun delegate is absent — the generated client does not carry this model"
      : `write threw: ${redactAndCap(reason instanceof Error ? reason.message : String(reason), 160)}`
  console.error(
    `[syncJobRunTelemetry] LOST a run row for "${ctx.jobName}" at ${where} — ${detail}. ` +
      "The job itself was unaffected; the freshness probe for this job_name will read CONFIG.",
  )
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

/**
 * The gap `reapAbandonedRuns` cannot close, swept across EVERY job name.
 *
 * The per-job reaper above runs from `withSyncJobRun`, so a job only self-heals **on its next
 * fire**. A job that never fires again — removed from the schedule, renamed, or dead because the
 * thing that fires it broke — keeps its `running` row forever, and that row is exactly the one
 * that matters: `computeJobHealth` checks `runningTooLong` BEFORE its freshness branches, so the
 * deadest job on the board reports amber "appears stuck" and can never escalate to red.
 *
 * The 30-minute cutoff is inherited deliberately. It is justified by the longest `maxDuration`
 * declared anywhere in this repo (300s, verified across `app/**`), not by the per-job scoping —
 * no invocation can outlive that ceiling, so a `running` row older than 30 minutes is abandoned
 * whoever owns it. Widening the sweep therefore does not require widening the window.
 *
 * ⚠ Returns `available: false` when the Prisma model is missing, because `reaped: 0` alone is
 * ambiguous — it reads identically for "nothing was stale" and "we could not look". The caller
 * needs to tell a healthy sweep from a blind one.
 */
export async function reapAllAbandonedRuns(
  options: { now?: number; abandonedAfterMs?: number } = {},
): Promise<{ available: boolean; reaped: number; cutoff: string }> {
  const now = options.now ?? Date.now()
  const cutoff = new Date(now - (options.abandonedAfterMs ?? ABANDONED_AFTER_MS))
  const model = getModel()
  if (!model || typeof model.updateMany !== "function") {
    return { available: false, reaped: 0, cutoff: cutoff.toISOString() }
  }
  try {
    const { count } = await model.updateMany({
      // No `jobName` — that omission IS the feature. Scoping this would reproduce the per-job
      // reaper and leave the never-fires-again case exactly as broken as it was.
      where: { status: "running", startedAt: { lt: cutoff } },
      data: {
        status: "failed",
        errorMessage:
          "abandoned: run never reported a terminal status (function killed at maxDuration, or the process died). Marked failed by the scheduled cross-job reaper.",
        completedAt: new Date(now),
      },
    })
    return { available: true, reaped: count ?? 0, cutoff: cutoff.toISOString() }
  } catch {
    // Best-effort, like its sibling — but report it as unavailable rather than as a clean zero.
    return { available: false, reaped: 0, cutoff: cutoff.toISOString() }
  }
}

/** Best-effort: write the initial `running` row. Returns its id or null. */
async function startRun(ctx: SyncJobContext): Promise<string | null> {
  const model = getModel()
  if (!model) {
    reportTelemetryLoss("startRun", ctx, undefined)
    return null
  }
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
  } catch (error) {
    reportTelemetryLoss("startRun", ctx, error)
    return null
  }
}

async function finishRun(
  ctx: SyncJobContext,
  id: string | null,
  payload: SyncJobRunPayload,
): Promise<void> {
  const model = getModel()
  /*
   * ⚠ A NULL `id` IS NOT A LOSS — `startRun` already reported why it could not open a row, and
   * saying so twice for one run would make the log read like two separate failures.
   */
  if (!id) return
  if (!model) {
    reportTelemetryLoss('finishRun', ctx, undefined)
    return
  }
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
  } catch (error) {
    // Still best-effort — the row is left `running` for the reaper, and now says so.
    reportTelemetryLoss('finishRun', ctx, error)
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
  // terminal status (see `reapAbandonedRuns`), so every instrumented job self-heals on its next
  // fire. Best-effort by design: a reaper failure must never stop the job from running.
  //
  // This covers only jobs that DO fire again. `/api/cron/reap-sync-runs` sweeps the rest on a
  // schedule via `reapAllAbandonedRuns`. (That route was previously impossible: the repo sat at
  // Vercel's 2048-route ceiling and carried a standing rule against new routes. Production moved
  // to Railway on 2026-09-02 and the rule was retired on 2026-09-05, so it exists now.)
  await reapAbandonedRuns(ctx.jobName)
  const id = await startRun(ctx)
  try {
    const result = await fn()
    const outcome = extract ? safeExtract(extract, result) : {}
    await finishRun(ctx, id, buildSyncJobRunPayload(ctx, outcome, null, Date.now() - startedAt))
    return result
  } catch (error) {
    await finishRun(ctx, id, buildSyncJobRunPayload(ctx, null, error, Date.now() - startedAt))
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
  if (!model) {
    reportTelemetryLoss("recordSyncJobRun", ctx, undefined)
    return
  }
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
  } catch (error) {
    reportTelemetryLoss("recordSyncJobRun", ctx, error)
  }
}
