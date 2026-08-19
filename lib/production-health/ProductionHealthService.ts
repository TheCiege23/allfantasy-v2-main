/**
 * ProductionHealthService — centralized operational health (Phase 4).
 *
 * Thin DB/composition layer over the pure `productionHealthCore` verdicts and
 * the existing admin resolvers. Every method is defensive: a DB or provider
 * failure degrades to a safe shape rather than throwing, so the health page
 * itself never takes the platform down.
 *
 * Public surface (as specified by Phase 4):
 *   getSystemHealth()          — overall rollup across crons, providers, sports.
 *   getProviderHealth()        — per-provider traffic light + outage isolation.
 *   getSportHealth("NFL")      — per-data-type freshness + AI data warnings.
 *   getCronStatus()            — instrumented job runtime health + untracked crons.
 *   getImportStatus()          — recent import run summaries.
 *   getCacheHealth()           — cache scope diagnostics.
 *   getSportDataWarningsForAi("NFL") — structured warnings for Chimmy grounding.
 */

import "server-only"

import { prisma } from "@/lib/prisma"
import {
  buildAiDataWarnings,
  classifyCronState,
  computeCacheHealth,
  computeFreshness,
  computeJobHealth,
  computeProviderHealth,
  rollupTrafficLights,
  type AiDataWarning,
  type CronState,
  type FreshnessStatus,
  type JobRunRecord,
  type ProviderHealth,
  type TrafficLight,
} from "@/lib/production-health/productionHealthCore"
import {
  getAdminPerSportDataReliabilityRows,
  type AdminSportDataReliabilityRow,
} from "@/lib/admin-dashboard/AdminProviderHealthService"
import { loadCronRegistry, type CronRegistryEntry } from "@/lib/production-health/cronRegistry"

const RUN_LOOKBACK_DAYS = 7
const RUN_FETCH_LIMIT = 500

function safeError(value: string | null | undefined): string | null {
  const text = value?.trim()
  if (!text) return null
  return text.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***").slice(0, 200)
}

// ───────────────────────────── Cron / import status ───────────────────────

export type CronEntryStatus = {
  path: string
  pathname: string
  schedule: string
  jobName: string
  sport: string | null
  provider: string | null
  category: string
  instrumented: boolean
  routeExists: boolean
  duplicate: boolean
  state: CronState
  trafficLight: TrafficLight
  message: string
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
}

export type CronStatusResult = {
  trafficLight: TrafficLight
  entries: CronEntryStatus[]
  counts: Record<CronState, number>
  missingRoutes: string[]
  duplicates: Array<{ path: string; schedules: string[] }>
  instrumentedCount: number
  totalDeclared: number
  /** Share of declared crons that are instrumented AND have a route. */
  coveragePct: number
  note: string
}

const EMPTY_CRON_COUNTS: Record<CronState, number> = {
  healthy: 0,
  running: 0,
  warning: 0,
  failed: 0,
  never_executed: 0,
  disabled: 0,
  missing_route: 0,
  provider_offline: 0,
  cache_stale: 0,
}

async function fetchRecentRuns(): Promise<JobRunRecord[]> {
  try {
    const since = new Date(Date.now() - RUN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    const model = (prisma as unknown as { syncJobRun?: { findMany: (a: unknown) => Promise<unknown[]> } }).syncJobRun
    if (!model?.findMany) return []
    const rows = (await model.findMany({
      where: { startedAt: { gte: since } },
      orderBy: { startedAt: "desc" },
      take: RUN_FETCH_LIMIT,
      select: {
        jobName: true,
        jobScope: true,
        status: true,
        rowsRead: true,
        rowsWritten: true,
        rowsSkipped: true,
        errorMessage: true,
        startedAt: true,
        completedAt: true,
        durationMs: true,
      },
    })) as Array<Record<string, unknown>>
    return rows.map((r) => ({
      jobName: String(r.jobName ?? ""),
      jobScope: (r.jobScope as string | null) ?? null,
      status: String(r.status ?? ""),
      rowsRead: Number(r.rowsRead ?? 0),
      rowsWritten: Number(r.rowsWritten ?? 0),
      rowsSkipped: Number(r.rowsSkipped ?? 0),
      errorMessage: safeError(r.errorMessage as string | null),
      startedAt: (r.startedAt as Date | null) ?? null,
      completedAt: (r.completedAt as Date | null) ?? null,
      durationMs: (r.durationMs as number | null) ?? null,
    }))
  } catch {
    return []
  }
}

function entryFromRegistry(entry: CronRegistryEntry, runsByJob: Map<string, JobRunRecord[]>): CronEntryStatus {
  const runs = runsByJob.get(entry.jobName) ?? []
  // Only instrumented crons can have meaningful runtime health; others have no
  // telemetry and resolve to never_executed (the message clarifies why).
  const jobHealth =
    entry.instrumented && runs.length > 0
      ? computeJobHealth({ jobName: entry.jobName, label: entry.jobName, staleAfterH: entry.staleAfterH }, runs)
      : null

  const classification = classifyCronState({
    routeExists: entry.routeExists,
    disabled: entry.disabled,
    jobHealth,
  })

  return {
    path: entry.path,
    pathname: entry.pathname,
    schedule: entry.schedule,
    jobName: entry.jobName,
    sport: entry.sport ?? null,
    provider: entry.provider ?? null,
    category: entry.category,
    instrumented: entry.instrumented,
    routeExists: entry.routeExists,
    duplicate: entry.duplicateOf !== null,
    state: classification.state,
    trafficLight: classification.trafficLight,
    message: classification.message,
    lastRunAt: jobHealth?.lastRunAt ?? null,
    lastSuccessAt: jobHealth?.lastSuccessAt ?? null,
    lastFailureAt: jobHealth?.lastFailureAt ?? null,
  }
}

export async function getCronStatus(): Promise<CronStatusResult> {
  const runs = await fetchRecentRuns()
  let registry
  try {
    registry = loadCronRegistry()
  } catch {
    registry = { entries: [], missingRoutes: [], duplicates: [], instrumentedCount: 0, totalDeclared: 0 }
  }

  const runsByJob = new Map<string, JobRunRecord[]>()
  for (const run of runs) {
    const list = runsByJob.get(run.jobName) ?? []
    list.push(run)
    runsByJob.set(run.jobName, list)
  }

  const entries = registry.entries.map((entry) => entryFromRegistry(entry, runsByJob))

  const counts: Record<CronState, number> = { ...EMPTY_CRON_COUNTS }
  for (const e of entries) counts[e.state] += 1

  const coveragePct =
    registry.totalDeclared > 0 ? Math.round((registry.instrumentedCount / registry.totalDeclared) * 100) : 0

  // A missing route or a failing job is the worst signal; never_executed is a
  // warning (telemetry gap) not a failure.
  const trafficLight = rollupTrafficLights(entries.map((e) => e.trafficLight))

  return {
    trafficLight,
    entries,
    counts,
    missingRoutes: registry.missingRoutes.map((m) => m.path),
    duplicates: registry.duplicates,
    instrumentedCount: registry.instrumentedCount,
    totalDeclared: registry.totalDeclared,
    coveragePct,
    note:
      registry.missingRoutes.length > 0
        ? `${registry.missingRoutes.length} declared cron(s) reference a missing route. ${counts.never_executed} job(s) have no telemetry yet.`
        : `${counts.never_executed} declared cron(s) have no telemetry yet; ${coveragePct}% are instrumented.`,
  }
}

export type ImportStatusRow = {
  jobName: string
  scope: string | null
  status: string
  rowsWritten: number
  rowsSkipped: number
  error: string | null
  startedAt: string | null
  completedAt: string | null
}

export type ImportStatusResult = {
  recent: ImportStatusRow[]
  failedLast24h: number
  succeededLast24h: number
}

export async function getImportStatus(): Promise<ImportStatusResult> {
  const runs = await fetchRecentRuns()
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000
  let failed = 0
  let succeeded = 0
  for (const r of runs) {
    const startedMs = r.startedAt instanceof Date ? r.startedAt.getTime() : r.startedAt ? Date.parse(r.startedAt) : 0
    if (startedMs < dayAgo) continue
    const s = r.status.toLowerCase()
    if (["failed", "error", "failure"].includes(s)) failed++
    else if (["success", "completed", "real", "cached_only"].includes(s)) succeeded++
  }
  return {
    recent: runs.slice(0, 40).map((r) => ({
      jobName: r.jobName,
      scope: r.jobScope ?? null,
      status: r.status,
      rowsWritten: Number(r.rowsWritten ?? 0),
      rowsSkipped: Number(r.rowsSkipped ?? 0),
      error: r.errorMessage ?? null,
      startedAt: r.startedAt instanceof Date ? r.startedAt.toISOString() : (r.startedAt as string | null),
      completedAt: r.completedAt instanceof Date ? r.completedAt.toISOString() : (r.completedAt as string | null),
    })),
    failedLast24h: failed,
    succeededLast24h: succeeded,
  }
}

// ───────────────────────────── Provider health ────────────────────────────

export type ProviderHealthResult = {
  trafficLight: TrafficLight
  providers: ProviderHealth[]
}

export async function getProviderHealth(): Promise<ProviderHealthResult> {
  try {
    const model = (prisma as unknown as {
      providerSyncState?: { findMany: (a: unknown) => Promise<unknown[]> }
    }).providerSyncState
    if (!model?.findMany) return { trafficLight: "unknown", providers: [] }

    const rows = (await model.findMany({
      orderBy: { updatedAt: "desc" },
      take: 400,
      select: {
        provider: true,
        lastSuccessAt: true,
        lastErrorAt: true,
        lastError: true,
        recordsImported: true,
        recordsUpdated: true,
        recordsSkipped: true,
      },
    })) as Array<Record<string, unknown>>

    // Collapse to the most recent row per provider (rows already desc by updatedAt).
    const byProvider = new Map<string, Record<string, unknown>>()
    for (const row of rows) {
      const key = String(row.provider ?? "").toLowerCase()
      if (!key || byProvider.has(key)) continue
      byProvider.set(key, row)
    }

    const providers = [...byProvider.values()].map((row) =>
      computeProviderHealth({
        provider: String(row.provider ?? ""),
        lastSuccessAt: (row.lastSuccessAt as Date | null) ?? null,
        lastErrorAt: (row.lastErrorAt as Date | null) ?? null,
        lastError: safeError(row.lastError as string | null),
        recordsImported: Number(row.recordsImported ?? 0),
        recordsUpdated: Number(row.recordsUpdated ?? 0),
        recordsSkipped: Number(row.recordsSkipped ?? 0),
      }),
    )

    return {
      trafficLight: rollupTrafficLights(providers.map((p) => p.trafficLight)),
      providers: providers.sort((a, b) => a.provider.localeCompare(b.provider)),
    }
  } catch {
    return { trafficLight: "unknown", providers: [] }
  }
}

// ───────────────────────────── Sport health ───────────────────────────────

export type SportDataTypeHealth = {
  dataType: string
  trafficLight: TrafficLight
  freshness: FreshnessStatus
  count: number | null
  lastSyncedAt: string | null
  summary: string
}

export type SportHealthResult = {
  sport: string
  label: string
  trafficLight: TrafficLight
  dataTypes: SportDataTypeHealth[]
  dataWarnings: AiDataWarning[]
  staleWarnings: string[]
}

const SPORT_DATA_TYPE_THRESHOLDS: Record<string, number> = {
  players: 24,
  projections: 24,
  injuries: 12,
  schedule: 168,
  standings: 24,
  score: 12,
  news: 24,
  playerStats: 48,
}

function buildSportHealthFromRow(row: AdminSportDataReliabilityRow): SportHealthResult {
  const sync = row.lastSyncAtByType
  // Map reliability row fields → canonical Phase 4 data types.
  const typeSpecs: Array<{ dataType: string; lastSyncedAt: string | null; count: number | null }> = [
    { dataType: "players", lastSyncedAt: sync.players ?? null, count: row.counts.players },
    { dataType: "projections", lastSyncedAt: sync.players ?? null, count: row.counts.players },
    { dataType: "injuries", lastSyncedAt: sync.injuries ?? null, count: row.counts.injuries },
    { dataType: "schedule", lastSyncedAt: sync.schedules ?? null, count: row.counts.schedules },
    { dataType: "standings", lastSyncedAt: (sync as Record<string, string | null>).standings ?? null, count: row.counts.standings },
    { dataType: "score", lastSyncedAt: sync.games ?? null, count: row.counts.liveScores },
    { dataType: "playerStats", lastSyncedAt: sync.playerStats ?? null, count: row.counts.playerStats },
  ]

  const freshnessByType: Record<string, FreshnessStatus> = {}
  const dataTypes: SportDataTypeHealth[] = typeSpecs.map((spec) => {
    const dataAvailable = spec.count == null ? undefined : spec.count > 0
    const f = computeFreshness(spec.lastSyncedAt, {
      label: `${row.label} ${spec.dataType}`,
      thresholds: { staleAfterH: SPORT_DATA_TYPE_THRESHOLDS[spec.dataType] ?? 24 },
      dataAvailable,
    })
    freshnessByType[spec.dataType] = f.status
    return {
      dataType: spec.dataType,
      trafficLight: f.trafficLight,
      freshness: f.status,
      count: spec.count,
      lastSyncedAt: f.lastSyncedAt,
      summary: f.summary,
    }
  })

  return {
    sport: row.sport,
    label: row.label,
    trafficLight: rollupTrafficLights(dataTypes.map((d) => d.trafficLight)),
    dataTypes,
    dataWarnings: buildAiDataWarnings(row.sport, freshnessByType),
    staleWarnings: row.staleWarnings,
  }
}

export async function getSportHealth(sport: string): Promise<SportHealthResult> {
  try {
    const rows = await getAdminPerSportDataReliabilityRows()
    const row = rows.find((r) => r.sport.toUpperCase() === sport.toUpperCase())
    if (!row) {
      return {
        sport: sport.toUpperCase(),
        label: sport.toUpperCase(),
        trafficLight: "unknown",
        dataTypes: [],
        dataWarnings: [
          {
            sport: sport.toUpperCase(),
            dataType: "all",
            status: "unavailable",
            severity: "critical",
            message: `No reliability data found for ${sport}.`,
            instruction: `No ${sport} data is available. Do not invent data; acknowledge the gap.`,
          },
        ],
        staleWarnings: [`No reliability row for ${sport}.`],
      }
    }
    return buildSportHealthFromRow(row)
  } catch {
    return {
      sport: sport.toUpperCase(),
      label: sport.toUpperCase(),
      trafficLight: "unknown",
      dataTypes: [],
      dataWarnings: [],
      staleWarnings: ["Sport health lookup failed."],
    }
  }
}

/** Convenience for AI grounding: just the structured warnings for a sport. */
export async function getSportDataWarningsForAi(sport: string): Promise<AiDataWarning[]> {
  const health = await getSportHealth(sport)
  return health.dataWarnings
}

// ───────────────────────────── Cache health ───────────────────────────────

export type CacheHealthResult = Awaited<ReturnType<typeof computeCacheHealth>>

export async function getCacheHealth(): Promise<CacheHealthResult> {
  try {
    const scopes: Array<{ name: string; count: number; lastUpdatedAt: Date | null }> = []

    const sportsCache = (prisma as unknown as {
      sportsDataCache?: { count: (a?: unknown) => Promise<number>; findFirst: (a: unknown) => Promise<{ updatedAt?: Date } | null> }
    }).sportsDataCache
    if (sportsCache?.count) {
      const [count, latest] = await Promise.all([
        sportsCache.count().catch(() => 0),
        sportsCache.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }).catch(() => null),
      ])
      scopes.push({ name: "Sports data cache", count, lastUpdatedAt: latest?.updatedAt ?? null })
    }

    const poolCache = (prisma as unknown as {
      draftPoolCache?: { count: (a?: unknown) => Promise<number>; findFirst: (a: unknown) => Promise<{ syncedAt?: Date } | null> }
    }).draftPoolCache
    if (poolCache?.count) {
      const [count, latest] = await Promise.all([
        poolCache.count().catch(() => 0),
        poolCache.findFirst({ orderBy: { syncedAt: "desc" }, select: { syncedAt: true } }).catch(() => null),
      ])
      scopes.push({ name: "Draft pool cache", count, lastUpdatedAt: latest?.syncedAt ?? null })
    }

    if (scopes.length === 0) return { trafficLight: "unknown", scopes: [] }
    return computeCacheHealth(scopes, { staleAfterH: 48 })
  } catch {
    return { trafficLight: "unknown", scopes: [] }
  }
}

// ───────────────────────────── System rollup ──────────────────────────────

export type SystemHealthResult = {
  trafficLight: TrafficLight
  generatedAt: string
  crons: CronStatusResult
  providers: ProviderHealthResult
  sports: SportHealthResult[]
  cache: CacheHealthResult
  imports: ImportStatusResult
  summary: string
}

export async function getSystemHealth(sports: string[] = ["NFL", "NCAAF"]): Promise<SystemHealthResult> {
  const [crons, providers, cache, imports, ...sportHealth] = await Promise.all([
    getCronStatus(),
    getProviderHealth(),
    getCacheHealth(),
    getImportStatus(),
    ...sports.map((s) => getSportHealth(s)),
  ])

  const trafficLight = rollupTrafficLights([
    crons.trafficLight,
    providers.trafficLight,
    cache.trafficLight,
    ...sportHealth.map((s) => s.trafficLight),
  ])

  const failedBits: string[] = []
  if (crons.trafficLight === "failed") {
    const failingCrons = crons.counts.failed + crons.counts.missing_route + crons.counts.provider_offline
    failedBits.push(`${failingCrons} cron(s) failing or missing a route`)
  }
  if (providers.trafficLight === "failed") failedBits.push("a provider is in outage")
  if (cache.trafficLight === "failed") failedBits.push("a cache scope is empty")
  for (const s of sportHealth) {
    if (s.trafficLight === "failed") failedBits.push(`${s.label} data is critically stale`)
  }

  return {
    trafficLight,
    generatedAt: new Date().toISOString(),
    crons,
    providers,
    sports: sportHealth,
    cache,
    imports,
    summary:
      trafficLight === "healthy"
        ? "All instrumented pipelines are healthy."
        : trafficLight === "warning"
          ? "Some pipelines need attention (stale or partial)."
          : failedBits.length > 0
            ? `Action required: ${failedBits.join("; ")}.`
            : "Health is unknown — telemetry is incomplete.",
  }
}
