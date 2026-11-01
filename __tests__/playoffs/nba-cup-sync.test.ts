import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import group from "../../contracts/espn/fixtures/scoreboard.NBA.20261106.json"
const db = vi.hoisted(() => ({ sportsDataCache: { findUnique: vi.fn(), upsert: vi.fn() }, playoffBracketChallenge: { findMany: vi.fn(), updateMany: vi.fn() }, playoffBracketSeries: { createMany: vi.fn(), updateMany: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: db }))
import { syncNbaCupTournament } from "@/lib/playoffs/syncNbaCupTournament"
import { assignNbaCupSlots, parseNbaCupScoreboard } from "@/lib/playoffs/nbaCupTournament"

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
  it("updates live scores and clock on a bounded date-level poll, then respects the 30-second cadence", async () => {
    vi.setSystemTime(new Date("2026-11-07T00:10:00Z"))
    const games = assignNbaCupSlots(parseNbaCupScoreboard(group, 2026))
    db.sportsDataCache.findUnique.mockResolvedValue({ data: { games, checkedDates: {}, cursor: 12, syncedAt: "2026-11-07T00:00:00Z" } })
    const live = structuredClone(group) as any
    live.events[0].status = { period: 1, displayClock: "11:20", type: { name: "STATUS_IN_PROGRESS", state: "in", completed: false, shortDetail: "11:20 - 1st" } }
    live.events[0].competitions[0].competitors.find((team: any) => team.homeAway === "home").score = "0"
    live.events[0].competitions[0].competitors.find((team: any) => team.homeAway === "away").score = "3"
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(live), { status: 200 }))
    expect(await syncNbaCupTournament({ season: 2026, apply: true, mode: "live" })).toMatchObject({ applied: true, activeGames: 1, failures: [] })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("dates=20261106"), expect.anything())
    expect(db.playoffBracketSeries.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "in_progress", liveHomeScore: 0, liveAwayScore: 3, liveStatus: "11:20 - 1st" }) }))
    const written = db.sportsDataCache.upsert.mock.calls[0][0].update.data
    expect(written.cursor).toBe(12)
    db.sportsDataCache.findUnique.mockResolvedValue({ data: written })
    vi.mocked(fetch).mockClear()
    vi.setSystemTime(new Date("2026-11-07T00:10:29Z"))
    expect(await syncNbaCupTournament({ season: 2026, apply: true, mode: "live" })).toMatchObject({ applied: false, activeGames: 1 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("does not poll providers or write pools when no known Cup game is near tipoff", async () => {
    const games = assignNbaCupSlots(parseNbaCupScoreboard(group, 2026))
    db.sportsDataCache.findUnique.mockResolvedValue({ data: { games, checkedDates: {}, cursor: 0, syncedAt: "2026-10-31T12:00:00Z" } })
    expect(await syncNbaCupTournament({ season: 2026, apply: true, mode: "live" })).toMatchObject({ applied: false, activeGames: 0 })
    expect(fetch).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("preserves verified finals and their scorers when the provider regresses to pregame", async () => {
    vi.setSystemTime(new Date("2026-11-07T00:10:00Z"))
    const games = assignNbaCupSlots(parseNbaCupScoreboard(group, 2026))
    games[0] = { ...games[0], status: "final", winnerTeamName: games[0].homeTeamName, homeScore: 110, awayScore: 100, homeLeaders: [{ name: "Verified scorer", points: 30 }] }
    games[1].startsAt = games[0].startsAt
    db.sportsDataCache.findUnique.mockResolvedValue({ data: { games, checkedDates: {}, cursor: 0, syncedAt: "2026-11-07T00:00:00Z" } })
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(group), { status: 200 }))
    await syncNbaCupTournament({ season: 2026, apply: true, mode: "live" })
    expect(db.sportsDataCache.upsert.mock.calls[0][0].update.data.games.find((game: any) => game.eventId === games[0].eventId))
      .toMatchObject({ status: "final", winnerTeamName: games[0].homeTeamName, homeScore: 110, homeLeaders: [{ name: "Verified scorer", points: 30 }] })
  })

  it("does not claim a fresh feed or rewrite pools when the live provider fails", async () => {
    vi.setSystemTime(new Date("2026-11-07T00:10:00Z"))
    const games = assignNbaCupSlots(parseNbaCupScoreboard(group, 2026))
    db.sportsDataCache.findUnique.mockResolvedValue({ data: { games, checkedDates: {}, cursor: 0, syncedAt: "2026-11-07T00:00:00Z" } })
    vi.mocked(fetch).mockResolvedValue(new Response("Unavailable", { status: 503 }))
    expect(await syncNbaCupTournament({ season: 2026, apply: true, mode: "live" })).toMatchObject({ poolsUpdated: 0, failures: [expect.objectContaining({ date: "20261106" })] })
    expect(db.sportsDataCache.upsert.mock.calls[0][0].update.data.syncedAt).toBe("2026-11-07T00:00:00Z")
    expect(db.playoffBracketSeries.updateMany).not.toHaveBeenCalled()
  })

  it("does not promote an earlier live leader to final top scorer without final player stats", async () => {
    vi.setSystemTime(new Date("2026-11-07T00:10:00Z"))
    const games = assignNbaCupSlots(parseNbaCupScoreboard(group, 2026))
    games[0] = { ...games[0], status: "in_progress", homeLeaders: [{ name: "Early leader", points: 5 }] }
    db.sportsDataCache.findUnique.mockResolvedValue({ data: { games, checkedDates: {}, cursor: 0, syncedAt: "2026-11-07T00:00:00Z" } })
    const finished = structuredClone(group) as any
    finished.events[0].status = { period: 4, type: { name: "STATUS_FINAL", state: "post", completed: true, shortDetail: "Final" } }
    finished.events[0].competitions[0].competitors.forEach((team: any) => { team.leaders = []; team.score = team.homeAway === "home" ? "110" : "100" })
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(finished), { status: 200 }))
    await syncNbaCupTournament({ season: 2026, apply: true, mode: "live" })
    expect(db.sportsDataCache.upsert.mock.calls[0][0].update.data.games.find((row: any) => row.eventId === games[0].eventId))
      .toMatchObject({ status: "final", homeLeaders: [] })
  })

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
