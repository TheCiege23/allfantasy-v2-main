/**
 * Phase 5 — cron telemetry truthfulness coverage.
 *
 * Covers the three new pure pieces:
 *   - classifyCronState: the 9 dashboard states (healthy/running/warning/failed/
 *     never_executed/disabled/missing_route/provider_offline/cache_stale).
 *   - buildCronRegistry: implemented/missing/duplicate detection + metadata.
 *   - buildSyncJobRunPayload: success/partial/failed mapping, error capture,
 *     metadata (sport/provider/retry), and extractCommonCounts.
 */

import { describe, expect, it } from "vitest"

import {
  classifyCronState,
  computeJobHealth,
  CRON_STATE_TRAFFIC_LIGHT,
  type JobRunRecord,
} from "@/lib/production-health/productionHealthCore"
import { buildCronRegistry, type RawCron } from "@/lib/production-health/cronRegistry"
import {
  buildSyncJobRunPayload,
  extractCommonCounts,
} from "@/lib/production-health/syncJobRunTelemetry"

const NOW = Date.parse("2026-06-25T12:00:00Z")
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

function healthyJobRuns(): JobRunRecord[] {
  return [
    {
      jobName: "cron-import-players",
      status: "success",
      rowsWritten: 100,
      startedAt: hoursAgo(1),
      completedAt: hoursAgo(1),
      durationMs: 900,
    },
  ]
}

// ───────────────────────────── classifyCronState ──────────────────────────

describe("classifyCronState — the 9 dashboard states", () => {
  it("disabled wins over everything", () => {
    expect(classifyCronState({ routeExists: true, disabled: true }).state).toBe("disabled")
  })

  it("missing_route when no route backs the path", () => {
    const r = classifyCronState({ routeExists: false })
    expect(r.state).toBe("missing_route")
    expect(r.trafficLight).toBe("failed")
  })

  it("provider_offline when the upstream provider is down", () => {
    const r = classifyCronState({ routeExists: true, providerOffline: true })
    expect(r.state).toBe("provider_offline")
    expect(r.trafficLight).toBe("failed")
  })

  it("never_executed when there is no telemetry", () => {
    expect(classifyCronState({ routeExists: true, jobHealth: null }).state).toBe("never_executed")
  })

  it("failed when the job's last run failed", () => {
    const job = computeJobHealth({ jobName: "j" }, [
      { jobName: "j", status: "failed", errorMessage: "boom", startedAt: hoursAgo(1), completedAt: hoursAgo(1) },
    ], { now: NOW })
    expect(classifyCronState({ routeExists: true, jobHealth: job }).state).toBe("failed")
  })

  it("running when actively running and not stuck", () => {
    const job = computeJobHealth({ jobName: "j", stuckAfterH: 2 }, [
      { jobName: "j", status: "running", startedAt: hoursAgo(0.1), completedAt: null },
    ], { now: NOW })
    expect(classifyCronState({ routeExists: true, jobHealth: job }).state).toBe("running")
  })

  it("cache_stale when the job ran but its cache is stale", () => {
    const job = computeJobHealth({ jobName: "j" }, healthyJobRuns(), { now: NOW })
    expect(classifyCronState({ routeExists: true, jobHealth: job, cacheStale: true }).state).toBe("cache_stale")
  })

  it("warning when the job verdict is a warning (e.g. stale success)", () => {
    // staleAfterH:1 → stale window 1h–7h; 3h old is stale (warning), not very_stale.
    const job = computeJobHealth({ jobName: "j", staleAfterH: 1 }, [
      { jobName: "j", status: "success", startedAt: hoursAgo(3), completedAt: hoursAgo(3) },
    ], { now: NOW })
    expect(classifyCronState({ routeExists: true, jobHealth: job }).state).toBe("warning")
  })

  it("healthy when the job recently succeeded", () => {
    const job = computeJobHealth({ jobName: "j" }, healthyJobRuns(), { now: NOW })
    expect(classifyCronState({ routeExists: true, jobHealth: job }).state).toBe("healthy")
  })

  it("every state maps to a traffic light", () => {
    for (const light of Object.values(CRON_STATE_TRAFFIC_LIGHT)) {
      expect(["healthy", "warning", "failed", "unknown"]).toContain(light)
    }
  })
})

// ───────────────────────────── buildCronRegistry ──────────────────────────

describe("buildCronRegistry — canonical mapping", () => {
  const crons: RawCron[] = [
    { path: "/api/cron/import-players", schedule: "0 */6 * * *" }, // implemented + instrumented
    { path: "/api/cron/ghost-job", schedule: "0 0 * * *" }, // missing route
    { path: "/api/cron/dupe", schedule: "0 1 * * *" }, // duplicate full path
    { path: "/api/cron/dupe", schedule: "0 2 * * *" },
    { path: "/api/brackets/wc/sync?job=teams", schedule: "0 3 * * *" }, // same pathname, distinct query
    { path: "/api/brackets/wc/sync?job=live", schedule: "*/5 * * * *" },
  ]
  // import-players exists; everything else does not.
  const routeExists = (pathname: string) => pathname === "/api/cron/import-players"

  const registry = buildCronRegistry(crons, routeExists)

  it("flags missing routes", () => {
    const missing = registry.missingRoutes.map((m) => m.path)
    expect(missing).toContain("/api/cron/ghost-job")
    expect(missing).not.toContain("/api/cron/import-players")
  })

  it("detects exact-path duplicates only", () => {
    const dupPaths = registry.duplicates.map((d) => d.path)
    expect(dupPaths).toContain("/api/cron/dupe")
    // distinct query strings on a shared pathname are NOT duplicates
    expect(dupPaths).not.toContain("/api/brackets/wc/sync?job=teams")
  })

  it("marks the second duplicate occurrence via duplicateOf", () => {
    const dupeEntries = registry.entries.filter((e) => e.pathname === "/api/cron/dupe")
    expect(dupeEntries[0].duplicateOf).toBeNull()
    expect(dupeEntries[1].duplicateOf).toBe("/api/cron/dupe")
  })

  it("applies the curated metadata overlay (instrumented jobName)", () => {
    const players = registry.entries.find((e) => e.pathname === "/api/cron/import-players")!
    expect(players.jobName).toBe("cron-import-players")
    expect(players.instrumented).toBe(true)
  })

  it("derives metadata (category + slug jobName) for unmapped crons", () => {
    const ghost = registry.entries.find((e) => e.pathname === "/api/cron/ghost-job")!
    expect(ghost.instrumented).toBe(false)
    expect(ghost.jobName).toBe("cron-ghost-job")
  })

  it("counts only instrumented + existing routes as covered", () => {
    // import-players is the only instrumented+existing one here.
    expect(registry.instrumentedCount).toBe(1)
    expect(registry.totalDeclared).toBe(crons.length)
  })
})

// ───────────────────────────── buildSyncJobRunPayload ─────────────────────

describe("buildSyncJobRunPayload — telemetry mapping", () => {
  const ctx = { jobName: "cron-import-players", sport: "NFL", provider: "multi" }

  it("records success with rows and provider/sport metadata", () => {
    const p = buildSyncJobRunPayload(ctx, { rowsWritten: 250, rowsUpdated: 10 }, null, 1500)
    expect(p.status).toBe("success")
    expect(p.rowsWritten).toBe(250)
    expect(p.durationMs).toBe(1500)
    expect(p.metadata.sport).toBe("NFL")
    expect(p.metadata.provider).toBe("multi")
    expect(p.metadata.rowsUpdated).toBe(10)
  })

  it("records failed when an error is thrown, capturing the message", () => {
    const p = buildSyncJobRunPayload(ctx, null, new Error("provider 503"), 800)
    expect(p.status).toBe("failed")
    expect(p.errorMessage).toMatch(/provider 503/)
  })

  it("records partial when warnings are present without an explicit status", () => {
    const p = buildSyncJobRunPayload(ctx, { rowsWritten: 5, warnings: ["3 rows skipped"] }, null, 100)
    expect(p.status).toBe("partial")
    expect(p.metadata.warnings).toEqual(["3 rows skipped"])
  })

  it("carries retryCount into metadata", () => {
    const p = buildSyncJobRunPayload(ctx, { retryCount: 2 }, null, 100)
    expect(p.metadata.retryCount).toBe(2)
  })

  it("redacts secrets from error messages", () => {
    const p = buildSyncJobRunPayload(ctx, null, new Error("bad key sk-ABC123secret zzz"), 10)
    expect(p.errorMessage).not.toMatch(/sk-ABC123secret/)
    expect(p.errorMessage).toMatch(/sk-\*\*\*/)
  })

  it("treats outcome errors array as a failure", () => {
    const p = buildSyncJobRunPayload(ctx, { errors: ["partial provider failure"] }, null, 10)
    expect(p.status).toBe("failed")
  })
})

describe("extractCommonCounts — heterogeneous importer results", () => {
  it("pulls rowsWritten from common field aliases", () => {
    expect(extractCommonCounts({ imported: 42 }).rowsWritten).toBe(42)
    expect(extractCommonCounts({ count: 7 }).rowsWritten).toBe(7)
    expect(extractCommonCounts({ inserted: 3 }).rowsWritten).toBe(3)
  })

  it("returns empty outcome for non-object results", () => {
    expect(extractCommonCounts(99)).toEqual({})
    expect(extractCommonCounts(null)).toEqual({})
  })

  it("captures warnings + errors arrays", () => {
    const o = extractCommonCounts({ imported: 1, warnings: ["w"], errors: ["e"] })
    expect(o.warnings).toEqual(["w"])
    expect(o.errors).toEqual(["e"])
  })
})
