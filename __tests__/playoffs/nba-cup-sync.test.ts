import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import group from "../../contracts/espn/fixtures/scoreboard.NBA.20261106.json"
const db = vi.hoisted(() => ({ sportsDataCache: { findUnique: vi.fn(), upsert: vi.fn() }, playoffBracketChallenge: { findMany: vi.fn(), updateMany: vi.fn() }, playoffBracketSeries: { createMany: vi.fn(), updateMany: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: db }))
import { syncNbaCupTournament } from "@/lib/playoffs/syncNbaCupTournament"

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers().setSystemTime(new Date("2026-10-31T12:00:00Z"))
  db.sportsDataCache.findUnique.mockResolvedValue(null)
  db.playoffBracketChallenge.findMany.mockResolvedValue([{ id: "cup" }])
  db.$queryRaw.mockResolvedValue([{ acquired: true }])
  db.$transaction.mockImplementation((fn: any) => fn(db))
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("20261106") ? group : { events: [] }), { status: 200 })))
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe("scheduled NBA Cup publisher", () => {
  it("publishes explicit group games, persists metadata and updates only live-season pools", async () => {
    const result = await syncNbaCupTournament({ season: 2026, apply: true })
    expect(result).toMatchObject({ applied: true, gamesPublished: 9, poolsUpdated: 1, failures: [] })
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(db.playoffBracketChallenge.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { sport: "nba_cup", seasonYear: 2026, isTestMode: false }, take: 100 }))
    expect(db.playoffBracketSeries.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true, data: expect.arrayContaining([expect.objectContaining({ round: "cup_group_play", homeTeamName: "Atlanta Hawks", providerGamesJson: expect.objectContaining({ provider: "espn_nba_cup", eventId: "401909287" }) })]) }))
  })
  it("dry-runs without changing the cache, matchups or any pool", async () => {
    const result = await syncNbaCupTournament({ season: 2026, apply: false })
    expect(result).toMatchObject({ applied: false, gamesDiscovered: 9 })
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.sportsDataCache.upsert).not.toHaveBeenCalled()
    expect(db.playoffBracketSeries.createMany).not.toHaveBeenCalled()
  })
  it("reports provider failures without filling games from unrelated NBA data", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response("Unavailable", { status: 503 }))
    const result = await syncNbaCupTournament({ season: 2026, apply: true })
    expect(result).toMatchObject({ gamesPublished: 0, failures: expect.arrayContaining([expect.objectContaining({ error: "NBA scoreboard HTTP 503" })]) })
    expect(db.playoffBracketSeries.createMany).not.toHaveBeenCalled()
  })
  it("does not apply a competing run when the season lock is already held", async () => {
    db.$queryRaw.mockResolvedValue([{ acquired: false }])
    expect(await syncNbaCupTournament({ season: 2026, apply: true })).toMatchObject({ applied: false, skipped: "sync_already_running" })
    expect(db.sportsDataCache.upsert).not.toHaveBeenCalled()
  })
})
