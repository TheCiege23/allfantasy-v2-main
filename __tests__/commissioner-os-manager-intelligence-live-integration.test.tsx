/**
 * The commissioner's Managers screen, live (2026-11-16, re-score item 11).
 *
 * ⚠ THIS SUITE HAS FLIPPED THREE TIMES, AND EACH TIME THE OLD ASSERTIONS WERE RIGHT FOR THEIR DAY: an
 * honest "backend does not classify archetypes" error; then a directory from
 * `/api/v1/intelligence/league/manager-dna`; then (item 10) the notice that the Milestone 32 privacy
 * pass had retired that route to a constant 410. Now the screen reads every manager's Competitive Edge
 * record IN-PROCESS — facts, never a profile — and the retired route stays retired.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ session: vi.fn(), league: vi.fn(), load: vi.fn(), transport: vi.fn() }))
vi.mock("next-auth", () => ({ getServerSession: h.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/commissioner-ui/resolveActiveLeagueId", () => ({ resolveActiveLeagueId: h.league }))
vi.mock("@/lib/competitive-edge/managerRecordLoader", () => ({ loadLeagueManagerRecords: h.load }))
vi.mock("@/lib/commissioner-ui/adapter/transport", () => ({ callDecisionOS: h.transport }))

import { liveManagerIntelligenceClient } from "@/lib/commissioner-ui/managers/decision-os-client/live"
import { demoManagerDirectory } from "@/lib/commissioner-ui/managers/decision-os-client/demo"

const RECORDS = demoManagerDirectory().map((e) => e.record)

beforeEach(() => {
  vi.clearAllMocks()
  h.session.mockResolvedValue({ user: { id: "u1" } })
  h.league.mockResolvedValue("L1")
  h.load.mockResolvedValue({ available: true, data: { league: { id: "L1", name: "X", platform: "sleeper" }, viewerTeamExternalId: "demo-mgr-1", records: RECORDS } })
})

describe("Managers live client", () => {
  it("every manager's record for the active league — the commissioner's own team included", async () => {
    const r = await liveManagerIntelligenceClient.getManagerDirectory()
    expect(r.error).toBeNull()
    expect(r.source).toBe("live")
    expect(r.data!.map((m) => m.managerName)).toEqual(["Priya Natarajan", "Sam Rivera", "Marcus Webb", "Devon Okafor"])
    expect(r.data![0]!.id).toBe("demo-mgr-1")
    expect(h.load).toHaveBeenCalledWith({ leagueId: "L1", userId: "u1", includeViewer: true })
  })

  it("never calls the retired Decision OS route", async () => {
    await liveManagerIntelligenceClient.getManagerDirectory()
    expect(h.transport).not.toHaveBeenCalled()
    const route = readFileSync(resolve(process.cwd(), "app/api/v1/intelligence/league/manager-dna/route.ts"), "utf8")
    expect(route).toMatch(/^export const GET = retiredProfileRoute$/m)
  })

  it("no session or no active league: an error naming it, no read", async () => {
    h.session.mockResolvedValueOnce(null)
    const a = await liveManagerIntelligenceClient.getManagerDirectory()
    expect(a.data).toBeNull()
    expect(a.error?.message).toBe("No active league could be resolved for this session.")
    h.league.mockResolvedValueOnce(null)
    const b = await liveManagerIntelligenceClient.getManagerDirectory()
    expect(b.error?.message).toBe("No active league could be resolved for this session.")
    expect(h.load).not.toHaveBeenCalled()
  })

  it("a refused league passes the loader's reason through; a throw is retryable", async () => {
    h.load.mockResolvedValueOnce({ available: false, reason: "Manager records are read only for a league you are in." })
    const refused = await liveManagerIntelligenceClient.getManagerDirectory()
    expect(refused.error).toMatchObject({ message: "Manager records are read only for a league you are in.", retryable: false })
    h.load.mockRejectedValueOnce(new Error("db down"))
    const thrown = await liveManagerIntelligenceClient.getManagerDirectory()
    expect(thrown.error).toMatchObject({ message: "Manager records could not be read right now.", retryable: true })
  })

  it("the page hands the adapter's error to the view", () => {
    const page = readFileSync(resolve(process.cwd(), "app/commissioner-os/managers/page.tsx"), "utf8")
    expect(page).toContain("errorMessage={response.error?.message}")
  })
})
