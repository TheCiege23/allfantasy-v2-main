import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import group from "../../contracts/espn/fixtures/scoreboard.NBA.20261106.json"
const db = vi.hoisted(() => ({ sportsDataCache: { findUnique: vi.fn(), upsert: vi.fn() }, playoffBracketChallenge: { findMany: vi.fn(), updateMany: vi.fn() }, playoffBracketSeries: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn() }))
const emitPlayoffDecisionAlerts = vi.hoisted(() => vi.fn())
vi.mock("@/lib/prisma", () => ({ prisma: db }))
vi.mock("@/lib/chimmy/bracketChangeAlerts", () => ({ emitPlayoffDecisionAlerts,
  settleBracketAlertBatch: async <T>(items: T[], send: (item: T) => Promise<unknown>) => {
    await Promise.all(items.map(send))
    return 0
  },
}))
import { syncNbaCupTournament } from "@/lib/playoffs/syncNbaCupTournament"
import { assignNbaCupSlots, parseNbaCupScoreboard } from "@/lib/playoffs/nbaCupTournament"

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers().setSystemTime(new Date("2026-10-31T12:00:00Z"))
  db.sportsDataCache.findUnique.mockResolvedValue(null)
  db.playoffBracketChallenge.findMany.mockResolvedValue([{ id: "cup" }])
  db.playoffBracketSeries.findMany.mockResolvedValue([])
  emitPlayoffDecisionAlerts.mockResolvedValue(undefined)
  db.$queryRaw.mockResolvedValue([{ acquired: true }])
  db.$transaction.mockImplementation((fn: any) => fn(db))
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("20261106") ? group : { events: [] }), { status: 200 })))
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe("scheduled NBA Cup publisher", () => {
  it("alerts opted-in entry owners about an existing series final only after commit", async () => {
    vi.setSystemTime(new Date("2026-11-07T00:10:00Z"))
    const games = assignNbaCupSlots(parseNbaCupScoreboard(group, 2026))
    games[0] = { ...games[0], status: "in_progress", winnerTeamName: null }
    db.sportsDataCache.findUnique.mockResolvedValue({ data: { games, checkedDates: {}, cursor: 12, syncedAt: "2026-11-07T00:00:00Z" } })
    db.playoffBracketSeries.findMany.mockResolvedValue([{ id: "series-1", challengeId: "cup",
      seriesNumber: games[0].seriesNumber, winnerTeamName: null,
      homeTeamName: games[0].homeTeamName, awayTeamName: games[0].awayTeamName }])
    const final = structuredClone(group) as any
    final.events[0].status = { period: 4, type: { name: "STATUS_FINAL", state: "post", completed: true, shortDetail: "Final" } }
    final.events[0].competitions[0].competitors.forEach((team: any) => {
      team.score = team.homeAway === "home" ? "110" : "100"
    })
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(final), { status: 200 }))
    let committed = false
    db.$transaction.mockImplementation(async (fn: any) => {
      const result = await fn(db)
      committed = true
      return result
    })
    emitPlayoffDecisionAlerts.mockImplementation(() => {
      expect(committed).toBe(true)
      return Promise.resolve()
    })
    await syncNbaCupTournament({ season: 2026, apply: true, mode: "live" })
    expect(emitPlayoffDecisionAlerts).toHaveBeenCalledWith({ challengeId: "cup", decisions: [expect.objectContaining({
      seriesId: "series-1", beforeWinner: null, winner: games[0].homeTeamName,
    })] })
  })
  it("supports the minute overlay on the same US game-night date and keeps its discovery cursor", async () => {
    vi.setSystemTime(new Date("2026-11-07T00:10:00Z"))
    const games = assignNbaCupSlots(parseNbaCupScoreboard(group, 2026))
    db.sportsDataCache.findUnique.mockResolvedValue({ data: { games, checkedDates: {}, cursor: 12, syncedAt: "2026-11-07T00:00:00Z" } })
    expect(await syncNbaCupTournament({ season: 2026, apply: true, liveOnly: true })).toMatchObject({ applied: true, failures: [] })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("dates=20261106"), expect.anything())
    const written = db.sportsDataCache.upsert.mock.calls[0][0].update.data
    expect(written.cursor).toBe(12)
    db.sportsDataCache.findUnique.mockResolvedValue({ data: written })
    vi.mocked(fetch).mockClear()
    vi.setSystemTime(new Date("2026-11-07T00:10:44Z"))
    expect(await syncNbaCupTournament({ season: 2026, apply: true, liveOnly: true })).toMatchObject({ applied: false })
    expect(fetch).not.toHaveBeenCalled()
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 8000, maxWait: 1000 })
  })
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
    expect(db.playoffBracketChallenge.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { sport: "nba_cup", seasonYear: 2026, isTestMode: false }, orderBy: { id: "asc" }, take: 101 }))
    expect(db.playoffBracketSeries.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true, data: expect.arrayContaining([expect.objectContaining({ round: "cup_group_play", homeTeamName: "Atlanta Hawks", providerGamesJson: expect.objectContaining({ provider: "espn_nba_cup", eventId: "401909287" }) })]) }))
  })
  it("catches up league 101 when the only new result is already in the snapshot", async () => {
    vi.setSystemTime(new Date("2026-11-07T00:10:00Z"))
    const games = assignNbaCupSlots(parseNbaCupScoreboard(group, 2026))
    games[0] = { ...games[0], status: "in_progress", winnerTeamName: null }
    let snapshot: any = { games, checkedDates: {}, cursor: 0, syncedAt: "2026-11-07T00:00:00Z" }
    db.sportsDataCache.findUnique.mockImplementation(async () => ({ data: snapshot }))
    db.sportsDataCache.upsert.mockImplementation(async (args: any) => { snapshot = args.update.data })
    const ids = Array.from({ length: 101 }, (_, i) => ({ id: `pool-${String(i).padStart(3, "0")}` }))
    db.playoffBracketChallenge.findMany.mockImplementation(async (args: any) =>
      ids.filter((row) => !args.where.id?.gt || row.id > args.where.id.gt).slice(0, args.take))
    const finished = structuredClone(group) as any
    finished.events[0].status = { period: 4, type: { name: "STATUS_FINAL", state: "post", completed: true, shortDetail: "Final" } }
    finished.events[0].competitions[0].competitors.forEach((team: any) => { team.score = team.homeAway === "home" ? "110" : "100" })
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(finished), { status: 200 }))

    expect(await syncNbaCupTournament({ season: 2026, apply: true, liveOnly: true })).toMatchObject({ poolsUpdated: 100 })
    expect(snapshot.fanout).toMatchObject({ cursor: "pool-099", eventIds: expect.arrayContaining([games[0].eventId]), restart: false })
    expect(db.playoffBracketSeries.updateMany.mock.calls.some(([args]: any) => args.where.challengeId.in.includes("pool-000") && args.data.winnerTeamName)).toBe(true)

    // No new provider response is due: the already verified result must still
    // be delivered to the remaining league from the durable snapshot.
    vi.mocked(fetch).mockClear()
    vi.setSystemTime(new Date("2026-11-07T00:10:01Z"))
    expect(await syncNbaCupTournament({ season: 2026, apply: true, liveOnly: true })).toMatchObject({ poolsUpdated: 1 })
    expect(fetch).not.toHaveBeenCalled()
    expect(db.playoffBracketSeries.updateMany.mock.calls.some(([args]: any) => args.where.challengeId.in.includes("pool-100") && args.data.winnerTeamName)).toBe(true)
    expect(snapshot.fanout).toBeNull()
  })

  it("restarts the sweep if another game changes after earlier leagues were visited", async () => {
    vi.setSystemTime(new Date("2026-11-07T00:10:00Z"))
    const games = assignNbaCupSlots(parseNbaCupScoreboard(group, 2026))
    games[0] = { ...games[0], status: "in_progress", winnerTeamName: null }
    let snapshot: any = { games, checkedDates: {}, cursor: 0, syncedAt: "2026-11-07T00:00:00Z" }
    db.sportsDataCache.findUnique.mockImplementation(async () => ({ data: snapshot }))
    db.sportsDataCache.upsert.mockImplementation(async (args: any) => { snapshot = args.update.data })
    const ids = Array.from({ length: 101 }, (_, i) => ({ id: `pool-${String(i).padStart(3, "0")}` }))
    db.playoffBracketChallenge.findMany.mockImplementation(async (args: any) =>
      ids.filter((row) => !args.where.id?.gt || row.id > args.where.id.gt).slice(0, args.take))
    const first = structuredClone(group) as any
    first.events[0].status = { period: 4, type: { name: "STATUS_FINAL", state: "post", completed: true, shortDetail: "Final" } }
    first.events[0].competitions[0].competitors.forEach((team: any) => { team.score = team.homeAway === "home" ? "110" : "100" })
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(first), { status: 200 }))
    await syncNbaCupTournament({ season: 2026, apply: true, mode: "live" })

    const second = structuredClone(first) as any
    second.events[1].status = { period: 4, type: { name: "STATUS_FINAL", state: "post", completed: true, shortDetail: "Final" } }
    second.events[1].competitions[0].competitors.forEach((team: any) => { team.score = team.homeAway === "home" ? "120" : "101" })
    vi.setSystemTime(new Date("2026-11-07T00:10:31Z"))
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(second), { status: 200 }))
    await syncNbaCupTournament({ season: 2026, apply: true, mode: "live" })
    expect(snapshot.fanout).toMatchObject({ cursor: null, restart: false })
    expect(snapshot.fanout.eventIds).toContain(games[1].eventId)

    vi.mocked(fetch).mockClear()
    vi.setSystemTime(new Date("2026-11-07T00:10:32Z"))
    await syncNbaCupTournament({ season: 2026, apply: true, mode: "live" })
    expect(db.playoffBracketSeries.updateMany.mock.calls.some(([args]: any) =>
      args.where.challengeId.in.includes("pool-000") && args.data.seriesNumber === games[1].seriesNumber && args.data.winnerTeamName)).toBe(true)
    expect(snapshot.fanout).toMatchObject({ cursor: "pool-099", restart: false })
    vi.setSystemTime(new Date("2026-11-07T00:10:33Z"))
    await syncNbaCupTournament({ season: 2026, apply: true, mode: "live" })
    expect(snapshot.fanout).toBeNull()
  })

  it("keeps the cursor pending when a batch fails so the next run can retry", async () => {
    vi.setSystemTime(new Date("2026-11-07T00:10:00Z"))
    const games = assignNbaCupSlots(parseNbaCupScoreboard(group, 2026))
    games[0] = { ...games[0], status: "final", winnerTeamName: games[0].homeTeamName }
    let snapshot: any = { games, checkedDates: { "20261106": "2026-11-07T00:10:00Z" }, cursor: 0,
      syncedAt: "2026-11-07T00:10:00Z", fanout: { eventIds: [games[0].eventId], cursor: "pool-099", restart: false } }
    db.sportsDataCache.findUnique.mockImplementation(async () => ({ data: snapshot }))
    db.sportsDataCache.upsert.mockImplementation(async (args: any) => { snapshot = args.update.data })
    db.playoffBracketChallenge.findMany.mockResolvedValue([{ id: "pool-100" }])
    db.$transaction.mockImplementation(async (fn: any) => {
      const before = snapshot
      try { return await fn(db) } catch (error) { snapshot = before; throw error }
    })
    db.playoffBracketSeries.updateMany.mockRejectedValueOnce(new Error("database unavailable"))
    await expect(syncNbaCupTournament({ season: 2026, apply: true, liveOnly: true })).rejects.toThrow("database unavailable")
    expect(snapshot.fanout).toMatchObject({ cursor: "pool-099", eventIds: [games[0].eventId] })
    db.playoffBracketSeries.updateMany.mockResolvedValue({ count: 1 })
    await syncNbaCupTournament({ season: 2026, apply: true, liveOnly: true })
    expect(snapshot.fanout).toBeNull()
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
