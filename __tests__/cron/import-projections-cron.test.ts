import { readFileSync } from "fs"
import { resolve } from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  fetchWithChain: vi.fn(),
  fantasyProjectionUpsert: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/workers/api-chain", () => ({
  fetchWithChain: mocks.fetchWithChain,
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    fantasyProjection: {
      upsert: mocks.fantasyProjectionUpsert,
    },
  },
}))

function req(url: string, secret?: string) {
  return new NextRequest(url, {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

describe("import-projections cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("CRON_SECRET", "cron-secret")
    mocks.fantasyProjectionUpsert.mockResolvedValue({})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("rejects missing or invalid auth and never touches a provider", async () => {
    const { GET } = await import("@/app/api/cron/import-projections/route")

    const missing = await GET(req("https://www.allfantasy.ai/api/cron/import-projections"))
    const invalid = await GET(req("https://www.allfantasy.ai/api/cron/import-projections", "bad-secret"))

    expect(missing.status).toBe(401)
    expect(invalid.status).toBe(401)
    expect(mocks.fetchWithChain).not.toHaveBeenCalled()
  })

  it("no-ops cleanly in the offseason without calling any provider", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z")) // solidly offseason for NFL and NCAAF

    const { GET } = await import("@/app/api/cron/import-projections/route")
    const res = await GET(req("https://www.allfantasy.ai/api/cron/import-projections", "cron-secret"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.results.NFL).toMatchObject({ ok: true, skipped: true })
    expect(body.results.NCAAF).toMatchObject({ ok: true, skipped: true })
    expect(mocks.fetchWithChain).not.toHaveBeenCalled()
    expect(mocks.fantasyProjectionUpsert).not.toHaveBeenCalled()
  })

  it("writes FantasyProjection rows via fetchWithChain when forced", async () => {
    mocks.fetchWithChain.mockResolvedValue({
      data: [
        { playerId: "cs_1", name: "Test Player", projectedPoints: 18.4, week: 5 },
        { playerId: "cs_2", name: "No Points Player" }, // no usable projection field — must be skipped
      ],
      fromCache: false,
      source: "clearsports",
    })

    const { GET } = await import("@/app/api/cron/import-projections/route")
    const res = await GET(
      req("https://www.allfantasy.ai/api/cron/import-projections?sport=NFL&season=2026&force=true", "cron-secret")
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.results.NFL).toMatchObject({ ok: true, synced: 1, source: "clearsports" })
    expect(mocks.fetchWithChain).toHaveBeenCalledWith(
      expect.objectContaining({ sport: "nfl", dataType: "projections", forceRefresh: true })
    )
    expect(mocks.fantasyProjectionUpsert).toHaveBeenCalledTimes(1)
    expect(mocks.fantasyProjectionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          uniq_fantasy_projection_player_week_scoring_source: expect.objectContaining({
            playerId: "cs_1",
            sport: "NFL",
            season: "2026",
            week: 5,
            scoringPresetId: "ppr",
            source: "clearsports",
          }),
        },
        create: expect.objectContaining({ projectedPoints: 18.4 }),
      })
    )
  })

  it("fails loudly (500) when the provider chain errors during an active season", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z")) // NFL in season

    mocks.fetchWithChain.mockResolvedValue({ data: null, fromCache: false, error: "All providers failed" })

    const { GET } = await import("@/app/api/cron/import-projections/route")
    const res = await GET(
      req("https://www.allfantasy.ai/api/cron/import-projections?sport=NFL&force=true", "cron-secret")
    )
    const body = await res.json()

    // Non-2xx matters: Vercel's cron dashboard keys off HTTP status, so a 200
    // carrying `ok:false` still reads as a healthy run.
    expect(res.status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.failedSports).toEqual(["NFL"])
    expect(body.results.NFL).toMatchObject({ ok: false, synced: 0, error: "All providers failed" })
    expect(mocks.fantasyProjectionUpsert).not.toHaveBeenCalled()
  })

  /**
   * THE PRODUCTION CASE. Measured 2026-08-10: `fantasy_projections` held only 43
   * seed rows because the provider returned an empty payload WITHOUT setting
   * `error`, so the old `ok: !chainResult.error` evaluated to true. The cron
   * returned 200 every day for a month while writing nothing, and the health
   * chip's Projections domain read a `fetchedAt` that never advanced.
   */
  it("treats an empty-but-error-free provider payload as failure during the season", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"))

    mocks.fetchWithChain.mockResolvedValue({ data: [], fromCache: false, source: "rolling_insights" })

    const { GET } = await import("@/app/api/cron/import-projections/route")
    const res = await GET(
      req("https://www.allfantasy.ai/api/cron/import-projections?sport=NFL", "cron-secret")
    )
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.results.NFL.ok).toBe(false)
    expect(body.results.NFL.error).toMatch(/in season/i)
    expect(mocks.fantasyProjectionUpsert).not.toHaveBeenCalled()
  })

  it("does NOT fail on an empty payload outside the season, even when forced", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-01T12:00:00Z")) // NFL offseason

    mocks.fetchWithChain.mockResolvedValue({ data: [], fromCache: false, source: "rolling_insights" })

    const { GET } = await import("@/app/api/cron/import-projections/route")
    const res = await GET(
      req("https://www.allfantasy.ai/api/cron/import-projections?sport=NFL&force=true", "cron-secret")
    )
    const body = await res.json()

    // Forced offseason runs legitimately return nothing — that must stay quiet,
    // or the alert becomes noise and gets ignored.
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.results.NFL).toMatchObject({ ok: true, synced: 0 })
  })
})

describe("import-projections cron Vercel config", () => {
  it("registers a daily cadence", () => {
    const root = resolve(__dirname, "..", "..")
    const json = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>
    }
    const entry = json.crons?.find((cron) => cron.path === "/api/cron/import-projections")
    expect(entry).toEqual({ path: "/api/cron/import-projections", schedule: "0 11 * * *" })
  })
})
