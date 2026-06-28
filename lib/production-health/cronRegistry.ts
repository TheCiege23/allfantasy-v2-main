/**
 * Canonical cron registry (Phase 5 — telemetry truthfulness).
 *
 * One source of truth that joins:
 *   - what vercel.json declares (path + schedule),
 *   - whether a route implementation exists on disk,
 *   - the stable telemetry jobName each cron writes (when instrumented),
 *   - sport / provider / category metadata,
 *   - duplicate detection.
 *
 * The pure builder (`buildCronRegistry`) takes the raw cron list + a
 * route-existence predicate so it is unit-testable without the filesystem.
 * `loadCronRegistry` is the thin IO wrapper that reads vercel.json and the
 * app/ tree.
 */

import fs from "fs"
import path from "path"

export type CronCategory =
  | "data-import"
  | "scores"
  | "standings"
  | "injuries"
  | "projections"
  | "waivers"
  | "draft"
  | "cache"
  | "ai"
  | "format-automation"
  | "integrity"
  | "brackets"
  | "misc"

export type CronMetadata = {
  /** Stable SyncJobRun.jobName this cron writes when instrumented. */
  jobName: string
  sport?: string
  provider?: string
  category: CronCategory
  /** A successful run older than this many hours is stale. */
  staleAfterH: number
  /** Whether this cron is instrumented to write SyncJobRun telemetry today. */
  instrumented: boolean
  disabled?: boolean
}

export type RawCron = { path: string; schedule: string }

export type CronRegistryEntry = CronMetadata & {
  path: string
  pathname: string
  schedule: string
  routeExists: boolean
  duplicateOf: string | null
}

export type CronRegistry = {
  entries: CronRegistryEntry[]
  missingRoutes: CronRegistryEntry[]
  duplicates: Array<{ path: string; schedules: string[] }>
  instrumentedCount: number
  totalDeclared: number
}

/**
 * Curated metadata overlay keyed by pathname (no query string). Entries flagged
 * `instrumented: true` write SyncJobRun via `withSyncJobRun`. Anything not in
 * the overlay is classified generically by `deriveMetadata`.
 */
const CRON_METADATA: Record<string, CronMetadata> = {
  "/api/cron/import-players": { jobName: "cron-import-players", category: "data-import", staleAfterH: 12, instrumented: true },
  "/api/cron/import-injuries": { jobName: "cron-import-injuries", category: "injuries", staleAfterH: 6, instrumented: true },
  "/api/cron/import-news": { jobName: "cron-import-news", category: "data-import", staleAfterH: 6, instrumented: true },
  "/api/cron/import-schedules": { jobName: "cron-import-schedules", category: "data-import", staleAfterH: 168, instrumented: true },
  "/api/cron/import-standings": { jobName: "cron-import-standings", category: "standings", staleAfterH: 24, instrumented: true },
  "/api/cron/import-scores": { jobName: "cron-import-scores", category: "scores", staleAfterH: 6, instrumented: true },
  "/api/cron/live-score-tick": { jobName: "cron-live-score-tick", category: "scores", staleAfterH: 1, instrumented: true },
  "/api/cron/import-depth-charts": { jobName: "cron-import-depth-charts", category: "data-import", staleAfterH: 168, instrumented: true },
  "/api/cron/adp-refresh": { jobName: "cron-adp-refresh", category: "data-import", staleAfterH: 36, instrumented: true },
  // Implemented but not yet wrapped in withSyncJobRun (multi-step / fan-out shapes).
  "/api/cron/recompute-allfantasy-adp": { jobName: "cron-recompute-allfantasy-adp", category: "data-import", staleAfterH: 36, instrumented: false },
  "/api/cron/draft-pool-prewarm": { jobName: "cron-draft-pool-prewarm", category: "draft", staleAfterH: 24, instrumented: false },
  "/api/cron/waivers": { jobName: "cron-waivers", category: "waivers", staleAfterH: 2, instrumented: false },
  // Known instrumented importers that run via library calls (not cron routes).
  "/api/redraft/score-sync": { jobName: "cron-redraft-score-sync", category: "scores", staleAfterH: 2, instrumented: true },
  "/api/redraft/waiver-process": { jobName: "redraft-waiver-process", category: "waivers", staleAfterH: 4, instrumented: false },
  "/api/cron/import-nfl-team-defense": { jobName: "cron-nfl-team-defense-import", category: "scores", staleAfterH: 4, instrumented: true },
}

function deriveCategory(pathname: string): CronCategory {
  if (pathname.includes("brackets")) return "brackets"
  if (pathname.includes("integrity")) return "integrity"
  if (pathname.includes("import-scores") || pathname.includes("score")) return "scores"
  if (pathname.includes("standings")) return "standings"
  if (pathname.includes("injur")) return "injuries"
  if (pathname.includes("projection") || pathname.includes("rankings")) return "projections"
  if (pathname.includes("waiver")) return "waivers"
  if (pathname.includes("draft") || pathname.includes("keeper") || pathname.includes("devy")) return "draft"
  if (pathname.includes("cache") || pathname.includes("prewarm") || pathname.includes("preload")) return "cache"
  if (pathname.includes("ai") || pathname.includes("chimmy") || pathname.includes("recap") || pathname.includes("storyline")) return "ai"
  if (pathname.includes("import") || pathname.includes("sync")) return "data-import"
  if (pathname.includes("automation") || pathname.includes("cron")) return "format-automation"
  return "misc"
}

function slugJobName(pathname: string): string {
  return pathname.replace(/^\/api\//, "").replace(/\//g, "-")
}

function deriveMetadata(pathname: string): CronMetadata {
  return {
    jobName: slugJobName(pathname),
    category: deriveCategory(pathname),
    staleAfterH: 24,
    instrumented: false,
  }
}

/**
 * Pure builder. `routeExists` is injected so this is testable without fs.
 */
export function buildCronRegistry(crons: RawCron[], routeExists: (pathname: string) => boolean): CronRegistry {
  // Duplicates are keyed on the FULL path (including query string). Routes that
  // share a pathname but use distinct query jobs (e.g. world-cup sync ?job=…)
  // are legitimately separate crons, not duplicates.
  const fullPathCounts = new Map<string, string[]>()
  for (const c of crons) {
    const list = fullPathCounts.get(c.path) ?? []
    list.push(c.schedule)
    fullPathCounts.set(c.path, list)
  }

  const seen = new Set<string>()
  const entries: CronRegistryEntry[] = crons.map((c) => {
    const pathname = c.path.split("?")[0]
    const meta = CRON_METADATA[pathname] ?? deriveMetadata(pathname)
    const isDuplicate = seen.has(c.path)
    seen.add(c.path)
    return {
      ...meta,
      path: c.path,
      pathname,
      schedule: c.schedule,
      routeExists: routeExists(pathname),
      duplicateOf: isDuplicate ? c.path : null,
    }
  })

  const duplicates = [...fullPathCounts.entries()]
    .filter(([, schedules]) => schedules.length > 1)
    .map(([path, schedules]) => ({ path, schedules }))

  return {
    entries,
    missingRoutes: entries.filter((e) => !e.routeExists),
    duplicates,
    instrumentedCount: entries.filter((e) => e.instrumented && e.routeExists).length,
    totalDeclared: entries.length,
  }
}

// ───────────────────────────── IO wrappers ────────────────────────────────

export function readVercelCrons(cwd: string = process.cwd()): RawCron[] {
  try {
    const raw = fs.readFileSync(path.join(cwd, "vercel.json"), "utf8")
    const parsed = JSON.parse(raw) as { crons?: Array<{ path?: unknown; schedule?: unknown }> }
    return (parsed.crons ?? [])
      .filter((c): c is RawCron => typeof c.path === "string" && typeof c.schedule === "string")
      .map((c) => ({ path: c.path, schedule: c.schedule }))
  } catch {
    return []
  }
}

export function routeExistsOnDisk(pathname: string, cwd: string = process.cwd()): boolean {
  const base = path.join(cwd, "app", pathname)
  return ["route.ts", "route.js", "route.tsx"].some((f) => fs.existsSync(path.join(base, f)))
}

export function loadCronRegistry(cwd: string = process.cwd()): CronRegistry {
  return buildCronRegistry(readVercelCrons(cwd), (pathname) => routeExistsOnDisk(pathname, cwd))
}

/** Map of pathname → stable jobName, for joining telemetry to declared crons. */
export function cronJobNameByPath(registry: CronRegistry): Map<string, string> {
  const map = new Map<string, string>()
  for (const e of registry.entries) map.set(e.pathname, e.jobName)
  return map
}
