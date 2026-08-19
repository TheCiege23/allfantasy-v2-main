/**
 * Production Health — pure core.
 *
 * Phase 4 (Production Data Health & Automation). All verdict logic lives here as
 * pure functions so it is fully unit-testable WITHOUT Prisma, env, or a live
 * server. `ProductionHealthService` is the thin DB layer that fetches rows and
 * feeds them through this core.
 *
 * Responsibilities:
 *   - Freshness tiers from a last-success timestamp.
 *   - Traffic-light verdicts (🟢 healthy / 🟡 warning / 🔴 failed / ⚪ unknown).
 *   - Cron/job runtime health from SyncJobRun rows (did it run? did it succeed?
 *     when did it last succeed/fail? is it stale? partial?).
 *   - Provider health from ProviderSyncState rows (outage isolation).
 *   - Cache health diagnostics (stale / expired / missing).
 *   - Structured AI data warnings so Chimmy never cites stale data as fact.
 *
 * Keep this file dependency-free (no imports). It is imported by both
 * server-only code and Node-side tests.
 */

// ───────────────────────────── Traffic lights ─────────────────────────────

export type TrafficLight = 'healthy' | 'warning' | 'failed' | 'unknown'

export const TRAFFIC_LIGHT_EMOJI: Record<TrafficLight, string> = {
  healthy: '🟢',
  warning: '🟡',
  failed: '🔴',
  unknown: '⚪',
}

const TRAFFIC_LIGHT_SEVERITY: Record<TrafficLight, number> = {
  unknown: 0,
  healthy: 1,
  warning: 2,
  failed: 3,
}

/**
 * Worst-of rollup. failed > warning > healthy > unknown. An empty list (or all
 * unknown) yields 'unknown'.
 */
export function rollupTrafficLights(lights: TrafficLight[]): TrafficLight {
  if (lights.length === 0) return 'unknown'
  const hasReal = lights.some((l) => l !== 'unknown')
  let worst: TrafficLight = hasReal ? 'healthy' : 'unknown'
  for (const light of lights) {
    if (TRAFFIC_LIGHT_SEVERITY[light] > TRAFFIC_LIGHT_SEVERITY[worst]) worst = light
  }
  return worst
}

// ───────────────────────────── Freshness ──────────────────────────────────

export type FreshnessStatus =
  | 'fresh'
  | 'recent'
  | 'stale'
  | 'very_stale'
  | 'pending'
  | 'unavailable'

export type FreshnessThresholds = {
  /** Below this many hours → "fresh". Default 6. */
  freshUnderH?: number
  /** Below this → "recent". At/after the stale threshold → "stale". Default 24. */
  staleAfterH?: number
  /** At/after this → "very_stale". Default 168 (7d). */
  veryStaleAfterH?: number
}

export type FreshnessReport = {
  status: FreshnessStatus
  ageHours: number | null
  lastSyncedAt: string | null
  trafficLight: TrafficLight
  summary: string
}

export function ageHoursFrom(iso: string | Date | null | undefined, now?: number): number | null {
  if (!iso) return null
  const ms = iso instanceof Date ? iso.getTime() : Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  return ((now ?? Date.now()) - ms) / 3_600_000
}

export function freshnessTrafficLight(status: FreshnessStatus): TrafficLight {
  switch (status) {
    case 'fresh':
    case 'recent':
      return 'healthy'
    case 'stale':
    case 'pending':
      return 'warning'
    case 'very_stale':
    case 'unavailable':
      return 'failed'
  }
}

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null
}

/**
 * Computes a freshness report from a last-success timestamp.
 *
 * - `dataAvailable === false` → "unavailable" (provider unconfigured / no rows).
 * - null/invalid timestamp (but data expected) → "pending" (never imported).
 */
export function computeFreshness(
  lastSyncedAt: string | Date | null | undefined,
  options: { label?: string; thresholds?: FreshnessThresholds; now?: number; dataAvailable?: boolean } = {},
): FreshnessReport {
  const label = options.label ?? 'Data'
  const staleAfterH = options.thresholds?.staleAfterH ?? 24
  const veryStaleAfterH = options.thresholds?.veryStaleAfterH ?? 168
  // Clamp the "fresh" window so a caller that lowers staleAfterH below the
  // default fresh window still gets a coherent ordering (fresh < stale).
  const freshUnderH = Math.min(options.thresholds?.freshUnderH ?? 6, staleAfterH)

  if (options.dataAvailable === false) {
    return {
      status: 'unavailable',
      ageHours: null,
      lastSyncedAt: null,
      trafficLight: freshnessTrafficLight('unavailable'),
      summary: `${label} unavailable — provider keys missing or import has never run.`,
    }
  }

  const ageHours = ageHoursFrom(lastSyncedAt, options.now)
  if (ageHours === null) {
    return {
      status: 'pending',
      ageHours: null,
      lastSyncedAt: null,
      trafficLight: freshnessTrafficLight('pending'),
      summary: `${label} import has not run yet — no successful sync recorded.`,
    }
  }

  let status: FreshnessStatus
  if (ageHours < freshUnderH) status = 'fresh'
  else if (ageHours < staleAfterH) status = 'recent'
  else if (ageHours < veryStaleAfterH) status = 'stale'
  else status = 'very_stale'

  const rounded = Math.round(ageHours * 10) / 10
  const ageText =
    ageHours < 1 ? `${Math.round(ageHours * 60)} min` : ageHours < 48 ? `${Math.round(ageHours)}h` : `${Math.round(ageHours / 24)}d`
  const summary =
    status === 'fresh' || status === 'recent'
      ? `${label} is current (synced ${ageText} ago).`
      : `${label} is ${status === 'very_stale' ? 'very stale' : 'stale'} (synced ${ageText} ago) — refresh overdue.`

  return {
    status,
    ageHours: rounded,
    lastSyncedAt: toIso(lastSyncedAt),
    trafficLight: freshnessTrafficLight(status),
    summary,
  }
}

// ───────────────────────────── Cron / job health ──────────────────────────

export type JobRunRecord = {
  jobName: string
  jobScope?: string | null
  status: string
  rowsRead?: number | null
  rowsWritten?: number | null
  rowsSkipped?: number | null
  errorMessage?: string | null
  startedAt: string | Date | null
  completedAt?: string | Date | null
  durationMs?: number | null
}

export type NormalizedRunStatus = 'success' | 'failed' | 'partial' | 'running' | 'unknown'

export function normalizeRunStatus(status: string | null | undefined): NormalizedRunStatus {
  const s = String(status ?? '').trim().toLowerCase()
  if (['success', 'completed', 'complete', 'ok', 'real', 'cached_only', 'done'].includes(s)) return 'success'
  if (['failed', 'failure', 'error', 'errored'].includes(s)) return 'failed'
  if (['partial', 'degraded', 'warning'].includes(s)) return 'partial'
  if (['running', 'pending', 'queued', 'processing', 'in_progress'].includes(s)) return 'running'
  return 'unknown'
}

export type JobHealth = {
  jobName: string
  label: string
  trafficLight: TrafficLight
  freshness: FreshnessStatus
  lastRunAt: string | null
  lastStatus: NormalizedRunStatus
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
  lastDurationMs: number | null
  lastRows: { read: number; written: number; skipped: number }
  succeededToday: boolean
  runningTooLong: boolean
  message: string
  warnings: string[]
  errors: string[]
}

function runTime(run: JobRunRecord): number {
  const t = run.completedAt ?? run.startedAt
  const ms = t instanceof Date ? t.getTime() : t ? Date.parse(t) : NaN
  return Number.isFinite(ms) ? ms : 0
}

export type ExpectedJob = {
  jobName: string
  label?: string
  /** A successful run older than this many hours is "stale". Default 24. */
  staleAfterH?: number
  /** A "running" job older than this many hours is considered stuck. Default 2. */
  stuckAfterH?: number
}

/**
 * Computes runtime health for a single job from its recent runs (any order).
 * `runs` may be empty (job never ran).
 */
export function computeJobHealth(
  expected: ExpectedJob,
  runs: JobRunRecord[],
  options: { now?: number } = {},
): JobHealth {
  const now = options.now ?? Date.now()
  const staleAfterH = expected.staleAfterH ?? 24
  const stuckAfterH = expected.stuckAfterH ?? 2
  const label = expected.label ?? expected.jobName

  const sorted = [...runs].sort((a, b) => runTime(b) - runTime(a))
  const last = sorted[0]
  const lastSuccess = sorted.find((r) => normalizeRunStatus(r.status) === 'success')
  const lastFailure = sorted.find((r) => normalizeRunStatus(r.status) === 'failed')

  const warnings: string[] = []
  const errors: string[] = []

  if (!last) {
    return {
      jobName: expected.jobName,
      label,
      trafficLight: 'failed',
      freshness: 'pending',
      lastRunAt: null,
      lastStatus: 'unknown',
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
      lastDurationMs: null,
      lastRows: { read: 0, written: 0, skipped: 0 },
      succeededToday: false,
      runningTooLong: false,
      message: `${label} has never run — no recorded job runs.`,
      warnings: [`${label} has no recorded runs.`],
      errors: [],
    }
  }

  const lastStatus = normalizeRunStatus(last.status)
  const lastSuccessAt = toIso(lastSuccess?.completedAt ?? lastSuccess?.startedAt ?? null)
  const lastFailureAt = toIso(lastFailure?.completedAt ?? lastFailure?.startedAt ?? null)
  const successAgeH = ageHoursFrom(lastSuccessAt, now)
  const succeededToday = successAgeH !== null && successAgeH < 24

  // Stuck detection: last run is still "running" and started long ago.
  const startedAgeH = ageHoursFrom(last.startedAt, now)
  const runningTooLong = lastStatus === 'running' && startedAgeH !== null && startedAgeH >= stuckAfterH

  const freshness = computeFreshness(lastSuccessAt, {
    label,
    thresholds: { staleAfterH, veryStaleAfterH: staleAfterH * 7 },
    now,
  }).status

  let trafficLight: TrafficLight
  let message: string

  if (lastStatus === 'failed') {
    trafficLight = 'failed'
    const errText = (last.errorMessage ?? '').trim() || 'unknown error'
    errors.push(errText)
    message = `${label} last run FAILED: ${errText}`
  } else if (runningTooLong) {
    trafficLight = 'warning'
    warnings.push(`${label} has been running for ${Math.round(startedAgeH!)}h without completing — possibly stuck.`)
    message = `${label} appears stuck (running ${Math.round(startedAgeH!)}h).`
  } else if (lastStatus === 'partial') {
    trafficLight = 'warning'
    const skipped = Number(last.rowsSkipped ?? 0)
    warnings.push(`${label} completed partially${skipped > 0 ? ` (${skipped} rows skipped)` : ''}.`)
    message = `${label} last run was PARTIAL.`
  } else if (lastStatus === 'running') {
    // Actively running and not stuck — healthy regardless of last-success age.
    trafficLight = 'healthy'
    message = `${label} is currently running.`
  } else if (freshness === 'very_stale') {
    trafficLight = 'failed'
    errors.push(`${label} last succeeded over ${staleAfterH * 7}h ago.`)
    message = `${label} is very stale — last success is overdue.`
  } else if (freshness === 'stale' || freshness === 'pending') {
    trafficLight = 'warning'
    warnings.push(`${label} last success is older than ${staleAfterH}h.`)
    message = `${label} is stale — last successful run is overdue.`
  } else if (lastStatus === 'success') {
    trafficLight = 'healthy'
    message = `${label} is healthy — last run succeeded.`
  } else {
    trafficLight = 'warning'
    warnings.push(`${label} last run status is unrecognized: "${last.status}".`)
    message = `${label} status is unknown.`
  }

  return {
    jobName: expected.jobName,
    label,
    trafficLight,
    freshness,
    lastRunAt: toIso(last.completedAt ?? last.startedAt ?? null),
    lastStatus,
    lastSuccessAt,
    lastFailureAt,
    lastError: lastFailure?.errorMessage?.trim() || null,
    lastDurationMs: typeof last.durationMs === 'number' ? last.durationMs : null,
    lastRows: {
      read: Number(last.rowsRead ?? 0),
      written: Number(last.rowsWritten ?? 0),
      skipped: Number(last.rowsSkipped ?? 0),
    },
    succeededToday,
    runningTooLong,
    message,
    warnings,
    errors,
  }
}

export type CronStatusReport = {
  trafficLight: TrafficLight
  jobs: JobHealth[]
  failed: string[]
  stale: string[]
  healthy: number
  total: number
}

/**
 * Aggregates per-job health across the expected job set, grouping the supplied
 * runs by jobName.
 */
export function computeCronStatus(
  expectedJobs: ExpectedJob[],
  runs: JobRunRecord[],
  options: { now?: number } = {},
): CronStatusReport {
  const byJob = new Map<string, JobRunRecord[]>()
  for (const run of runs) {
    const list = byJob.get(run.jobName) ?? []
    list.push(run)
    byJob.set(run.jobName, list)
  }

  const jobs = expectedJobs.map((expected) =>
    computeJobHealth(expected, byJob.get(expected.jobName) ?? [], options),
  )

  return {
    trafficLight: rollupTrafficLights(jobs.map((j) => j.trafficLight)),
    jobs,
    failed: jobs.filter((j) => j.trafficLight === 'failed').map((j) => j.jobName),
    stale: jobs.filter((j) => j.trafficLight === 'warning').map((j) => j.jobName),
    healthy: jobs.filter((j) => j.trafficLight === 'healthy').length,
    total: jobs.length,
  }
}

// ───────────────────────────── Cron state classification ──────────────────

/**
 * Richer per-cron state the admin dashboard distinguishes. This sits on top of
 * the JobHealth verdict and folds in route existence, disabled flags, and
 * provider/cache signals so every declared cron resolves to a concrete state
 * (never a bare "unknown" unless it genuinely has never executed).
 */
export type CronState =
  | "healthy"
  | "running"
  | "warning"
  | "failed"
  | "never_executed"
  | "disabled"
  | "missing_route"
  | "provider_offline"
  | "cache_stale"

export const CRON_STATE_TRAFFIC_LIGHT: Record<CronState, TrafficLight> = {
  healthy: "healthy",
  running: "healthy",
  warning: "warning",
  failed: "failed",
  never_executed: "warning",
  disabled: "unknown",
  missing_route: "failed",
  provider_offline: "failed",
  cache_stale: "warning",
}

export type ClassifyCronInput = {
  /** Whether a route file backs this cron's path. */
  routeExists: boolean
  /** Operator-disabled (kept in vercel.json but intentionally inactive). */
  disabled?: boolean
  /** Job runtime health from SyncJobRun, or null if the job has no telemetry. */
  jobHealth?: JobHealth | null
  /** True when the job's provider is in a known outage. */
  providerOffline?: boolean
  /** True when the cache this job maintains is stale. */
  cacheStale?: boolean
}

export type CronStateResult = {
  state: CronState
  trafficLight: TrafficLight
  message: string
}

/**
 * Resolves the dashboard state for a single declared cron. Priority order:
 *   disabled → missing route → provider offline → never executed →
 *   (job verdict: failed / running / partial-warning / cache-stale / healthy).
 */
export function classifyCronState(input: ClassifyCronInput): CronStateResult {
  if (input.disabled) {
    return { state: "disabled", trafficLight: CRON_STATE_TRAFFIC_LIGHT.disabled, message: "Disabled — not scheduled to run." }
  }
  if (!input.routeExists) {
    return {
      state: "missing_route",
      trafficLight: CRON_STATE_TRAFFIC_LIGHT.missing_route,
      message: "Declared in vercel.json but no route implementation exists.",
    }
  }
  if (input.providerOffline) {
    return {
      state: "provider_offline",
      trafficLight: CRON_STATE_TRAFFIC_LIGHT.provider_offline,
      message: "Upstream provider is offline — job cannot fetch fresh data.",
    }
  }

  const job = input.jobHealth
  // No telemetry row at all → the job has never executed (or is uninstrumented).
  if (!job || (job.lastRunAt === null && job.lastSuccessAt === null)) {
    return {
      state: "never_executed",
      trafficLight: CRON_STATE_TRAFFIC_LIGHT.never_executed,
      message: "No recorded execution — job is uninstrumented or has never run.",
    }
  }

  if (job.lastStatus === "failed" || job.trafficLight === "failed") {
    return { state: "failed", trafficLight: "failed", message: job.message }
  }
  if (job.lastStatus === "running" && !job.runningTooLong) {
    return { state: "running", trafficLight: "healthy", message: job.message }
  }
  if (input.cacheStale) {
    return { state: "cache_stale", trafficLight: CRON_STATE_TRAFFIC_LIGHT.cache_stale, message: "Job ran but its cache is stale." }
  }
  if (job.trafficLight === "warning") {
    return { state: "warning", trafficLight: "warning", message: job.message }
  }
  return { state: "healthy", trafficLight: "healthy", message: job.message }
}

// ───────────────────────────── Provider health ────────────────────────────

export type ProviderSyncRecord = {
  provider: string
  configured?: boolean
  lastSuccessAt?: string | Date | null
  lastErrorAt?: string | Date | null
  lastError?: string | null
  recordsImported?: number | null
  recordsUpdated?: number | null
  recordsSkipped?: number | null
}

export type ProviderHealth = {
  provider: string
  trafficLight: TrafficLight
  configured: boolean
  freshness: FreshnessStatus
  lastSuccessAt: string | null
  lastErrorAt: string | null
  lastError: string | null
  records: { imported: number; updated: number; skipped: number }
  message: string
}

/**
 * Provider outage isolation: a provider whose most recent event is an error
 * (newer than its last success) is "failed" independently of other providers.
 */
export function computeProviderHealth(
  record: ProviderSyncRecord,
  options: { staleAfterH?: number; now?: number } = {},
): ProviderHealth {
  const staleAfterH = options.staleAfterH ?? 24
  const now = options.now ?? Date.now()
  const configured = record.configured ?? true

  const successAt = toIso(record.lastSuccessAt ?? null)
  const errorAt = toIso(record.lastErrorAt ?? null)
  const successMs = successAt ? Date.parse(successAt) : -Infinity
  const errorMs = errorAt ? Date.parse(errorAt) : -Infinity

  const records = {
    imported: Number(record.recordsImported ?? 0),
    updated: Number(record.recordsUpdated ?? 0),
    skipped: Number(record.recordsSkipped ?? 0),
  }

  if (!configured) {
    return {
      provider: record.provider,
      trafficLight: 'warning',
      configured: false,
      freshness: 'unavailable',
      lastSuccessAt: successAt,
      lastErrorAt: errorAt,
      lastError: record.lastError?.trim() || null,
      records,
      message: `${record.provider} is not configured (missing env) — chain falls back.`,
    }
  }

  // Recent error wins → provider outage.
  if (errorMs > successMs && errorAt) {
    return {
      provider: record.provider,
      trafficLight: 'failed',
      configured: true,
      freshness: computeFreshness(successAt, { thresholds: { staleAfterH }, now }).status,
      lastSuccessAt: successAt,
      lastErrorAt: errorAt,
      lastError: record.lastError?.trim() || 'recent failure',
      records,
      message: `${record.provider} is FAILING — last event was an error (${record.lastError?.trim() || 'unknown'}).`,
    }
  }

  const freshness = computeFreshness(successAt, {
    label: record.provider,
    thresholds: { staleAfterH, veryStaleAfterH: staleAfterH * 7 },
    now,
  })

  let trafficLight: TrafficLight = freshness.trafficLight
  let message: string
  if (freshness.status === 'fresh' || freshness.status === 'recent') {
    message = `${record.provider} is healthy — synced ${freshness.ageHours ?? '?'}h ago.`
  } else if (freshness.status === 'pending') {
    trafficLight = 'warning'
    message = `${record.provider} has no successful sync recorded yet.`
  } else {
    message = `${record.provider} data is ${freshness.status.replace('_', ' ')} — refresh overdue.`
  }

  return {
    provider: record.provider,
    trafficLight,
    configured: true,
    freshness: freshness.status,
    lastSuccessAt: successAt,
    lastErrorAt: errorAt,
    lastError: record.lastError?.trim() || null,
    records,
    message,
  }
}

// ───────────────────────────── Cache health ───────────────────────────────

export type CacheScopeSummary = {
  name: string
  count: number
  lastUpdatedAt?: string | Date | null
  expiresAt?: string | Date | null
}

export type CacheDiagnostic = {
  name: string
  trafficLight: TrafficLight
  count: number
  reason: 'ok' | 'missing' | 'empty' | 'stale' | 'expired'
  message: string
}

export function computeCacheHealth(
  scopes: CacheScopeSummary[],
  options: { staleAfterH?: number; now?: number } = {},
): { trafficLight: TrafficLight; scopes: CacheDiagnostic[] } {
  const staleAfterH = options.staleAfterH ?? 24
  const now = options.now ?? Date.now()

  const diagnostics: CacheDiagnostic[] = scopes.map((scope) => {
    if (scope.count <= 0) {
      return {
        name: scope.name,
        trafficLight: 'failed',
        count: 0,
        reason: 'empty',
        message: `${scope.name} cache is empty — 0 entries.`,
      }
    }
    const expiresMs = scope.expiresAt ? (scope.expiresAt instanceof Date ? scope.expiresAt.getTime() : Date.parse(scope.expiresAt)) : null
    if (expiresMs !== null && Number.isFinite(expiresMs) && expiresMs < now) {
      return {
        name: scope.name,
        trafficLight: 'warning',
        count: scope.count,
        reason: 'expired',
        message: `${scope.name} cache is expired (expiry passed).`,
      }
    }
    const ageH = ageHoursFrom(scope.lastUpdatedAt ?? null, now)
    if (ageH !== null && ageH >= staleAfterH) {
      return {
        name: scope.name,
        trafficLight: 'warning',
        count: scope.count,
        reason: 'stale',
        message: `${scope.name} cache is stale (updated ${Math.round(ageH)}h ago).`,
      }
    }
    return {
      name: scope.name,
      trafficLight: 'healthy',
      count: scope.count,
      reason: 'ok',
      message: `${scope.name} cache is healthy (${scope.count} entries).`,
    }
  })

  return {
    trafficLight: rollupTrafficLights(diagnostics.map((d) => d.trafficLight)),
    scopes: diagnostics,
  }
}

// ───────────────────────────── AI data warnings (Chimmy) ──────────────────

export type AiDataWarning = {
  sport: string
  dataType: string
  status: FreshnessStatus
  severity: 'warning' | 'critical'
  message: string
  instruction: string
}

function aiInstructionFor(status: FreshnessStatus, sport: string, dataType: string): string {
  switch (status) {
    case 'stale':
      return `${sport} ${dataType} is stale. Say "as of the last import" before citing it and recommend a refresh.`
    case 'very_stale':
      return `${sport} ${dataType} is very stale. Do NOT cite specific ${dataType} numbers as current fact; warn the user it may be outdated.`
    case 'pending':
      return `${sport} ${dataType} has not been imported. Do not cite any ${dataType}; tell the user an import is needed.`
    case 'unavailable':
      return `No ${sport} ${dataType} is available. Do not invent ${dataType}; acknowledge the data gap honestly.`
    default:
      return `${sport} ${dataType} is current; you may cite it with confidence.`
  }
}

/**
 * Builds structured data warnings for AI grounding. Only emits warnings for
 * statuses that should change how Chimmy answers (stale and worse). Fresh/recent
 * data produces no warning.
 */
export function buildAiDataWarnings(
  sport: string,
  freshnessByType: Record<string, FreshnessStatus>,
): AiDataWarning[] {
  const warnings: AiDataWarning[] = []
  for (const [dataType, status] of Object.entries(freshnessByType)) {
    if (status === 'fresh' || status === 'recent') continue
    const severity: AiDataWarning['severity'] =
      status === 'very_stale' || status === 'unavailable' || status === 'pending' ? 'critical' : 'warning'
    warnings.push({
      sport,
      dataType,
      status,
      severity,
      message: `${sport} ${dataType} is ${status.replace('_', ' ')}.`,
      instruction: aiInstructionFor(status, sport, dataType),
    })
  }
  return warnings
}
