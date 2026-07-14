/**
 * Phase 4 — Production health wiring invariants.
 *
 * The verdict logic is unit-tested in production-health-core.test.ts. These
 * source-level invariants lock the composition layer (service → route → admin
 * page) and the Chimmy grounding wiring so the operational surface cannot
 * silently regress. (The service is server-only and DB-bound; asserting wiring
 * via source is the same pattern the draft-room regression suite uses.)
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(__dirname, "..", "..")
const read = (p: string) => readFileSync(resolve(root, p), "utf8")

const serviceSrc = read("lib/production-health/ProductionHealthService.ts")
const routeSrc = read("app/api/admin/production-health/route.ts")
const pageSrc = read("app/admin/production-health/page.tsx")
const chimmyPacketSrc = read("lib/ai/leagueSportsGroundingPacket.ts")

describe("ProductionHealthService — public surface", () => {
  it("exports all six named health APIs", () => {
    for (const fn of [
      "export async function getSystemHealth",
      "export async function getProviderHealth",
      "export async function getSportHealth",
      "export async function getCronStatus",
      "export async function getImportStatus",
      "export async function getCacheHealth",
    ]) {
      expect(serviceSrc).toContain(fn)
    }
  })

  it("exposes a Chimmy-facing data-warnings helper", () => {
    expect(serviceSrc).toContain("export async function getSportDataWarningsForAi")
  })

  it("feeds DB rows through the pure tested core (not ad-hoc logic)", () => {
    expect(serviceSrc).toMatch(/from ["']@\/lib\/production-health\/productionHealthCore["']/)
    expect(serviceSrc).toMatch(/classifyCronState\(/)
    expect(serviceSrc).toMatch(/computeJobHealth\(/)
    expect(serviceSrc).toMatch(/computeProviderHealth\(/)
    expect(serviceSrc).toMatch(/computeFreshness\(/)
    expect(serviceSrc).toMatch(/rollupTrafficLights\(/)
    expect(serviceSrc).toMatch(/buildAiDataWarnings\(/)
  })

  it("reads cron runtime telemetry from SyncJobRun and providers from ProviderSyncState", () => {
    expect(serviceSrc).toMatch(/syncJobRun/)
    expect(serviceSrc).toMatch(/providerSyncState/)
  })

  it("reports missing routes + instrumentation coverage instead of faking health", () => {
    expect(serviceSrc).toMatch(/missingRoutes/)
    expect(serviceSrc).toMatch(/loadCronRegistry/)
    expect(serviceSrc).toMatch(/coveragePct/)
  })

  it("is defensive — every public method falls back to a safe shape", () => {
    // Each exported function body contains a try/catch or composes ones that do.
    expect(serviceSrc).toMatch(/catch\s*\{[\s\S]*?trafficLight: "unknown"/)
  })
})

describe("/api/admin/production-health route", () => {
  it("is admin-gated via requireAdminOrBearer", () => {
    expect(routeSrc).toMatch(/requireAdminOrBearer\(request\)/)
    expect(routeSrc).toMatch(/if \(!gate\.ok\) return gate\.res/)
  })

  it("routes each view to the matching service method", () => {
    expect(routeSrc).toMatch(/getSystemHealth\(\)/)
    expect(routeSrc).toMatch(/getCronStatus\(\)/)
    expect(routeSrc).toMatch(/getProviderHealth\(\)/)
    expect(routeSrc).toMatch(/getCacheHealth\(\)/)
    expect(routeSrc).toMatch(/getImportStatus\(\)/)
    expect(routeSrc).toMatch(/getSportHealth\(sport\)/)
  })
})

describe("admin production-health page", () => {
  it("is admin-gated and denies forbidden users", () => {
    expect(pageSrc).toMatch(/getAdminAccessState\(\)/)
    expect(pageSrc).toMatch(/status === "unauthenticated"/)
    expect(pageSrc).toMatch(/status === "forbidden"/)
  })

  it("renders traffic-light status for NFL and NCAAF", () => {
    expect(pageSrc).toMatch(/getSystemHealth\(\["NFL", "NCAAF"\]\)/)
    expect(pageSrc).toMatch(/TRAFFIC_LIGHT_EMOJI/)
  })

  it("surfaces cron, provider, cache, and import sections plus missing routes + duplicates", () => {
    expect(pageSrc).toMatch(/Scheduled Jobs/)
    expect(pageSrc).toMatch(/Providers/)
    expect(pageSrc).toMatch(/Cache/)
    expect(pageSrc).toMatch(/Imports/)
    expect(pageSrc).toMatch(/missingRoutes/)
    expect(pageSrc).toMatch(/duplicates/)
    expect(pageSrc).toMatch(/CRON_STATE_LABEL/)
  })
})

describe("getCronStatus — registry-driven (Phase 5)", () => {
  it("classifies every declared cron via the registry + classifyCronState", () => {
    expect(serviceSrc).toMatch(/loadCronRegistry\(\)/)
    expect(serviceSrc).toMatch(/classifyCronState\(/)
    expect(serviceSrc).toMatch(/missingRoutes/)
    expect(serviceSrc).toMatch(/duplicates/)
    expect(serviceSrc).toMatch(/coveragePct/)
  })

  it("reports counts across all cron states (no bare 'unknown' bucket)", () => {
    expect(serviceSrc).toMatch(/counts\[e\.state\] \+= 1/)
  })
})

describe("instrumented cron routes write SyncJobRun telemetry", () => {
  const routes = [
    "app/api/cron/import-players/route.ts",
    "app/api/cron/import-injuries/route.ts",
    "app/api/cron/import-news/route.ts",
    "app/api/cron/import-standings/route.ts",
    "app/api/cron/import-scores/route.ts",
    "app/api/cron/import-depth-charts/route.ts",
    "app/api/cron/adp-refresh/route.ts",
  ]
  it.each(routes)("%s wraps its work in withSyncJobRun", (route) => {
    const src = read(route)
    expect(src).toMatch(/from ["']@\/lib\/production-health\/syncJobRunTelemetry["']/)
    expect(src).toMatch(/withSyncJobRun\(/)
    expect(src).toMatch(/jobName: "cron-/)
  })
})

describe("vercel.json reconciliation", () => {
  const vercel = JSON.parse(read("vercel.json")) as { crons: Array<{ path: string; schedule: string }> }

  it("has no exact-duplicate cron paths", () => {
    const counts = new Map<string, number>()
    for (const c of vercel.crons) counts.set(c.path, (counts.get(c.path) ?? 0) + 1)
    const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([p]) => p)
    expect(dupes).toEqual([])
  })

  it("no longer references the dead zombie-weekly-update route", () => {
    expect(vercel.crons.some((c) => c.path.includes("zombie-weekly-update"))).toBe(false)
  })
})

describe("Chimmy grounding — structured data warnings", () => {
  it("imports the tested buildAiDataWarnings from the production-health core", () => {
    expect(chimmyPacketSrc).toMatch(/buildAiDataWarnings.*from ["']@\/lib\/production-health\/productionHealthCore["']/)
  })

  it("adds a dataWarnings field to the packet and serializes it for the prompt", () => {
    expect(chimmyPacketSrc).toMatch(/dataWarnings: AiDataWarning\[\]/)
    expect(chimmyPacketSrc).toMatch(/const dataWarnings = buildPacketDataWarnings\(/)
    expect(chimmyPacketSrc).toMatch(/_dataWarnings: dataWarnings/)
  })

  it("treats empty domains as unavailable/pending so Chimmy never invents data", () => {
    expect(chimmyPacketSrc).toMatch(/count === 0 \? \(unavailable \? "unavailable" : "pending"\)/)
  })
})
