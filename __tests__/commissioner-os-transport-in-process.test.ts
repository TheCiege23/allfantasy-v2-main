import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/*
 * Commissioner OS → Decision OS, in-process (2026-11-14).
 *
 * The intelligence reads used to be HTTP calls back into this same deployment and needed
 * DECISION_OS_BASE_URL + an API key + the public-API flag. These tests pin the replacement:
 * the league reads run as function calls with NO base URL configured, retired profile paths
 * still answer 410, unknown paths keep the HTTP behaviour, and the public gate still refuses an
 * HTTP-shaped context.
 */

const getServerSessionMock = vi.hoisted(() => vi.fn())
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

const provider = vi.hoisted(() => ({
  getLeagueIntelligence: vi.fn(),
  getManagerIntelligence: vi.fn(),
  getPlatformIntelligence: vi.fn(),
  getLeagueManagerIntelligences: vi.fn(),
}))
vi.mock("@/lib/decision-os/behavioral/api/real-data-provider", () => ({ realDataProvider: provider }))

const snapshots = vi.hoisted(() => ({ getRecentLeagueSnapshots: vi.fn() }))
vi.mock("@/lib/decision-os/behavioral/history/snapshots", () => snapshots)
vi.mock("@/lib/decision-os/behavioral/deadlines/deadlineIntelligence", () => ({
  deriveLeagueDeadlineIntelligence: vi.fn(async () => null),
}))
vi.mock("@/lib/decision-os/managerDnaDirectory", () => ({ resolveManagerDnaDirectory: vi.fn() }))

import { callDecisionOS, type DecisionOSTransportConfig } from "@/lib/commissioner-ui/adapter/transport"
import { runIntelligenceInProcess } from "@/lib/decision-os/behavioral/api/in-process"
import { leagueTrendIntelligenceHandler } from "@/lib/decision-os/behavioral/api/intelligence-handlers"

const ORIGINAL_ENV = { ...process.env }
const NO_BASE_URL: DecisionOSTransportConfig = { baseUrl: null, apiKey: null, timeoutMs: 5000 }

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV }
  delete process.env.DECISION_OS_INTELLIGENCE_API_ENABLED
  delete process.env.DECISION_OS_TRANSPORT
  getServerSessionMock.mockResolvedValue(null)
  provider.getLeagueIntelligence.mockReset()
  snapshots.getRecentLeagueSnapshots.mockReset()
  snapshots.getRecentLeagueSnapshots.mockResolvedValue([])
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.unstubAllGlobals()
})

describe("runIntelligenceInProcess", () => {
  it("serves the trend read with the public flag OFF and no API key", async () => {
    const result = await runIntelligenceInProcess("/api/v1/intelligence/league/trend?leagueId=L1")
    expect(result?.status).toBe(200)
    expect(snapshots.getRecentLeagueSnapshots).toHaveBeenCalledWith("L1", 2)
    expect((result?.body as { meta: { tier: string } }).meta.tier).toBe("commissioner")
  })

  it("answers 410 for the retired profile routes, exactly as the HTTP routes do", async () => {
    for (const path of [
      "/api/v1/intelligence/league/managers?leagueId=L1",
      "/api/v1/intelligence/league/manager-dna?leagueId=L1",
    ]) {
      const result = await runIntelligenceInProcess(path)
      expect(result?.status, path).toBe(410)
    }
  })

  it("returns null for a path it does not serve, so the caller keeps its HTTP behaviour", async () => {
    expect(await runIntelligenceInProcess("/api/v1/intelligence/platform")).toBeNull()
    expect(await runIntelligenceInProcess("/health")).toBeNull()
  })

  it("still validates the request — a missing leagueId is a 400", async () => {
    const result = await runIntelligenceInProcess("/api/v1/intelligence/league")
    expect(result?.status).toBe(400)
  })
})

describe("the public gate is unchanged for an HTTP-shaped context", () => {
  it("refuses with 503 when the flag is off and no internal tier is set", async () => {
    const result = await leagueTrendIntelligenceHandler({
      headers: { get: () => null },
      searchParams: new URLSearchParams("leagueId=L1"),
    })
    expect(result.status).toBe(503)
    expect(snapshots.getRecentLeagueSnapshots).not.toHaveBeenCalled()
  })
})

describe("callDecisionOS — in-process transport", () => {
  it("returns real data with NO base URL configured and never calls fetch", async () => {
    provider.getLeagueIntelligence.mockResolvedValue(null)
    const trend = await callDecisionOS("mission-control", "/api/v1/intelligence/league/trend?leagueId=L1", {}, NO_BASE_URL)
    expect(trend.error).toBeNull()
    expect(trend.data).toMatchObject({ data: { available: false } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("maps an in-process 503 to the same upstream_unavailable contract the HTTP path uses", async () => {
    provider.getLeagueIntelligence.mockResolvedValue(null)
    const result = await callDecisionOS("league-health", "/api/v1/intelligence/league?leagueId=L1", {}, NO_BASE_URL)
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "league-health" })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("maps a retired profile route to an error, never to data", async () => {
    const result = await callDecisionOS("managers", "/api/v1/intelligence/league/manager-dna?leagueId=L1", {}, NO_BASE_URL)
    expect(result.data).toBeNull()
    expect(result.error).not.toBeNull()
  })

  it("DECISION_OS_TRANSPORT=http restores the old behaviour (placeholder with no base URL)", async () => {
    process.env.DECISION_OS_TRANSPORT = "http"
    const result = await callDecisionOS("mission-control", "/api/v1/intelligence/league/trend?leagueId=L1", {}, NO_BASE_URL)
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", retryable: false })
    expect(snapshots.getRecentLeagueSnapshots).not.toHaveBeenCalled()
  })
})
