import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const m = vi.hoisted(() => ({ findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), key: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/prisma", () => ({ prisma: { sportsDataCache: { findUnique: m.findUnique, create: m.create, updateMany: m.updateMany } } }))
vi.mock("@/lib/cfbd-env", () => ({ getCfbdApiKey: m.key }))
import { syncCfpPreview } from "@/lib/playoffs/syncCfpPreview"

const teams = ["Miami", "Georgia", "Utah", "Indiana", "Alabama", "Kentucky", "Texas", "UCLA", "BYU", "Ole Miss", "Notre Dame", "Ohio State", "Tennessee", "LSU", "Texas Tech", "Wake Forest", "Houston", "Missouri", "Iowa", "USC", "South Carolina", "Arizona", "Oregon", "Florida", "Boise State"]
const conferences = ["ACC", "SEC", "Big 12", "Big Ten", "SEC", "SEC", "SEC", "Big Ten", "Big 12", "SEC", "FBS Independents", "Big Ten", "SEC", "SEC", "Big 12", "ACC", "Big 12", "SEC", "Big Ten", "Big Ten", "SEC", "Big 12", "Big Ten", "SEC", "Pac-12"]
const ranking = [{ season: 2026, seasonType: "regular", week: 10, polls: [{ poll: "Playoff Committee Rankings", ranks: teams.map((school, i) => ({ school, rank: i + 1, conference: conferences[i] })) }] }]
const scheduled = { season: 2026, competition: "cfp", status: "scheduled", rounds: [] }

beforeEach(() => { vi.clearAllMocks(); m.key.mockReturnValue("test-key"); m.findUnique.mockResolvedValue(null); m.create.mockResolvedValue({}); m.updateMany.mockResolvedValue({ count: 1 }) })
afterEach(() => vi.unstubAllGlobals())
describe("scheduled CFP preview refresh", () => {
  it("stores validated rankings and keeps provider calls out of the browser", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes("rankings") ? ranking : scheduled })))
    const result = await syncCfpPreview({ season: 2026, apply: true, now: new Date("2026-11-08T18:00:00Z") })
    expect(result).toMatchObject({ rankings: "updated", bowls: "updated" })
    const call = m.create.mock.calls.map(([arg]) => arg.data).find(row => row.cacheKey.includes("projection"))
    expect(call.data.value).toMatchObject({ rankingDate: "2026-11-03", groupSix: "Boise State" })
    expect(call.data.value.teams).toHaveLength(12)
  })
  it("does not call the provider on dry runs or when the cache is fresh", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch)
    await syncCfpPreview({ season: 2026, apply: false, now: new Date("2026-11-08T18:00:00Z") })
    m.findUnique.mockResolvedValue({ data: { fetchedAt: "2026-11-08T17:59:00Z", value: [] } })
    const result = await syncCfpPreview({ season: 2026, apply: true, now: new Date("2026-11-08T18:00:00Z") })
    expect(fetch).not.toHaveBeenCalled(); expect(result).toMatchObject({ rankings: "current", bowls: "current" })
  })
  it("does not replace a newer cached ranking with an older provider response", async () => {
    m.findUnique.mockImplementation(async ({ where }: { where: { cacheKey: string } }) => ({ data: { fetchedAt: "2026-11-08T17:00:00Z", value: where.cacheKey.includes("projection") ? { rankingDate: "2026-11-10" } : [] } }))
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes("rankings") ? ranking : scheduled })))
    const result = await syncCfpPreview({ season: 2026, apply: true, now: new Date("2026-11-08T18:00:00Z") })
    expect(result).toMatchObject({ rankings: "older-provider-data" })
    expect(m.updateMany.mock.calls.every(([arg]) => !arg.where.cacheKey.includes("projection"))).toBe(true)
  })
  it("keeps previously cached data when the provider fails", async () => {
    m.findUnique.mockResolvedValue({ data: { fetchedAt: "2026-11-08T17:00:00Z", value: [] } })
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
    expect(await syncCfpPreview({ season: 2026, apply: true, now: new Date("2026-11-08T18:00:00Z") })).toMatchObject({ rankings: "unavailable", bowls: "unavailable" })
    expect(m.updateMany).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled()
  })
})
