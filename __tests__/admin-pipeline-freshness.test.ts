import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/*
 * Every model the service reads, stubbed by delegate name. A spec whose delegate is
 * missing here fails LOUDLY ("Cannot read properties of undefined") rather than
 * silently reaching a real database.
 */
const latest = vi.hoisted(() => ({
  syncJobRun: vi.fn(),
  leagueSyncState: vi.fn(),
  weeklyMatchup: vi.fn(),
  roster: vi.fn(),
  managerPsychProfile: vi.fn(),
  decisionOsImportedActivity: vi.fn(),
  aiAdpSnapshot: vi.fn(),
  depthChart: vi.fn(),
}))

vi.mock("@/lib/prisma", () => {
  const prisma: Record<string, unknown> = {}
  for (const [delegate, fn] of Object.entries(latest)) {
    prisma[delegate] = {
      aggregate: async (args: { _max: Record<string, true> }) => {
        const field = Object.keys(args._max)[0]
        return { _max: { [field]: await (fn as () => Promise<Date | null>)() } }
      },
    }
  }
  return { prisma }
})

import {
  PIPELINE_SPECS,
  buildPipelineRow,
  getAdminPipelineFreshness,
  resetPipelineFreshnessCache,
} from "@/lib/admin-dashboard/AdminPipelineFreshnessService"

const NOW = Date.parse("2026-09-22T13:00:00.000Z")
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000)

const spec = { id: "x", label: "League sync", table: "league_sync_state", cadence: "30m", warnAfterH: 2, failAfterH: 6 }

describe("buildPipelineRow", () => {
  it("is healthy inside the amber threshold", () => {
    expect(buildPipelineRow(spec, { ok: true, latest: hoursAgo(1) }, NOW).trafficLight).toBe("healthy")
  })

  it("goes amber past the warn threshold and red past the fail threshold", () => {
    expect(buildPipelineRow(spec, { ok: true, latest: hoursAgo(3) }, NOW).trafficLight).toBe("warning")
    expect(buildPipelineRow(spec, { ok: true, latest: hoursAgo(7) }, NOW).trafficLight).toBe("failed")
  })

  it("does not call a table that was never written 'fresh'", () => {
    const row = buildPipelineRow(spec, { ok: true, latest: null }, NOW)
    expect(row.trafficLight).not.toBe("healthy")
    expect(row.lastWriteAt).toBeNull()
  })

  it("reports a failed read as unknown — neither fresh nor never-written", () => {
    const row = buildPipelineRow(spec, { ok: false, reason: "timeout" }, NOW)
    expect(row.status).toBe("query_failed")
    expect(row.trafficLight).toBe("unknown")
    expect(row.summary).toContain("could not be measured")
  })
})

describe("getAdminPipelineFreshness", () => {
  beforeEach(() => {
    resetPipelineFreshnessCache()
    for (const fn of Object.values(latest)) fn.mockReset().mockResolvedValue(hoursAgo(0.05))
  })
  afterEach(() => vi.useRealTimers())

  it("measures every spec from its own table", async () => {
    const result = await getAdminPipelineFreshness({ now: NOW })
    expect(result.rows.map((r) => r.id)).toEqual(PIPELINE_SPECS.map((s) => s.id))
    expect(result.overall).toBe("healthy")
    for (const fn of Object.values(latest)) expect(fn).toHaveBeenCalledTimes(1)
  })

  it("rolls a single stalled pipeline up to the overall verdict", async () => {
    latest.roster.mockResolvedValue(hoursAgo(48))
    const result = await getAdminPipelineFreshness({ now: NOW })
    expect(result.rows.find((r) => r.id === "rosters")?.trafficLight).toBe("failed")
    expect(result.overall).toBe("failed")
  })

  it("isolates a throwing query to its own row", async () => {
    latest.weeklyMatchup.mockRejectedValue(new Error("relation does not exist\nstack…"))
    const result = await getAdminPipelineFreshness({ now: NOW })
    const row = result.rows.find((r) => r.id === "matchups")
    expect(row?.status).toBe("query_failed")
    expect(row?.summary).toContain("relation does not exist")
    expect(result.rows.find((r) => r.id === "rosters")?.trafficLight).toBe("healthy")
  })

  it("gives up on a hung query instead of holding the panel", async () => {
    vi.useFakeTimers()
    latest.depthChart.mockReturnValue(new Promise(() => undefined))
    const pending = getAdminPipelineFreshness({ now: NOW })
    await vi.advanceTimersByTimeAsync(5_001)
    const result = await pending
    expect(result.rows.find((r) => r.id === "depth-charts")?.status).toBe("query_failed")
  })

  it("caches a clean result, so a one-minute page refresh does not rescan every table", async () => {
    await getAdminPipelineFreshness({ now: NOW })
    await getAdminPipelineFreshness({ now: NOW + 60_000 })
    expect(latest.roster).toHaveBeenCalledTimes(1)
    await getAdminPipelineFreshness({ now: NOW + 6 * 60_000 })
    expect(latest.roster).toHaveBeenCalledTimes(2)
  })

  it("does not cache a result with a failed read, so the next refresh retries it", async () => {
    latest.roster.mockRejectedValueOnce(new Error("blip"))
    await getAdminPipelineFreshness({ now: NOW })
    const second = await getAdminPipelineFreshness({ now: NOW + 60_000 })
    expect(latest.roster).toHaveBeenCalledTimes(2)
    expect(second.rows.find((r) => r.id === "rosters")?.trafficLight).toBe("healthy")
  })
})
