import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const db = vi.hoisted(() => ({
  playoffBracketChallenge: { findUnique: vi.fn(), create: vi.fn() },
  playoffBracketEntry: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  playoffBracketSeries: { findUnique: vi.fn(), findMany: vi.fn(), createMany: vi.fn(), update: vi.fn() },
  playoffBracketPick: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
  sportsDataCache: { findUnique: vi.fn() }, $transaction: vi.fn(), $queryRaw: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({ prisma: db }))
vi.mock("@/lib/auth/admin", () => ({ hasPoolAdminAccess: () => false }))
vi.mock("@/lib/entitlements/afCommissionerPlan", () => ({ hasAfCommissionerPlan: async () => false }))
vi.mock("@/lib/subscription/EntitlementResolver", () => ({ EntitlementResolver: class { async resolveSnapshot() { return {} } } }))
vi.mock("@/lib/subscription/livePlanFlags", () => ({ planFlagsFromSnapshot: () => ({ pro: false }) }))
vi.mock("@/lib/playoffs/playoffSeeding", () => ({ resolvePlayoffSeedField: vi.fn(() => { throw new Error("Manual field must not be required for NBA Cup") }) }))
vi.mock("@/lib/playoffs/teamIntelligence", () => ({ loadBracketTeamProfiles: async () => ({}) }))
vi.mock("@/lib/sport-teams/storedTeamLogos", () => ({ getStoredTeamLogoResolver: async () => () => null }))

import { createPlayoffBracketChallenge, createPlayoffBracketEntry, savePlayoffBracketPick, submitPlayoffBracketEntry, finalizeNbaCupDay } from "@/lib/playoffs/playoffService"
import { buildPlayoffTemplate } from "@/lib/playoffs/playoffTemplate"

const challenge = { id: "cup", sport: "nba_cup", seasonYear: 2026, isTestMode: false, ownerUserId: "user", config: { lockRule: "none", maxEntriesPerParticipant: 5 } }
const game = { ...buildPlayoffTemplate({ sport: "nba_cup", seasonYear: 2026 })[0], id: "future", challengeId: "cup", homeTeamName: "Boston Celtics", awayTeamName: "Charlotte Hornets", startsAt: new Date("2026-11-07T00:00:00Z"), challenge }
const input = { challengeId: "cup", entryId: "entry", userId: "user", seriesId: "future", pickTeamName: "Boston Celtics", confirmationMode: "per_day" as const }

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers().setSystemTime(new Date("2026-11-01T12:00:00Z"))
  db.$transaction.mockImplementation((fn: any) => fn(db))
  db.playoffBracketEntry.findUnique.mockResolvedValue({ id: "entry", userId: "user", challengeId: "cup", finalizedAt: new Date("2026-10-29T00:00:00Z"), tiebreakerTotalScore: 210, challenge })
  db.playoffBracketSeries.findUnique.mockResolvedValue(game)
  db.playoffBracketSeries.findMany.mockResolvedValue([game, { ...game, id: "past", seriesNumber: 101, startsAt: new Date("2026-10-30T23:00:00Z") }])
  db.playoffBracketPick.findMany.mockResolvedValue([{ id: "pick", entryId: "entry", seriesId: "future", pickTeamName: "Boston Celtics", createdAt: "", updatedAt: "" }])
  db.playoffBracketPick.upsert.mockResolvedValue({ id: "pick" })
  db.playoffBracketEntry.findMany.mockResolvedValue([])
  db.playoffBracketEntry.count.mockResolvedValue(0)
  db.playoffBracketEntry.create.mockResolvedValue({ id: "entry-new" })
  db.sportsDataCache.findUnique.mockResolvedValue(null)
})
afterEach(() => vi.useRealTimers())

describe("NBA Cup server rules", () => {
  it("creates a league and entry without requiring the knockout field or complete schedule", async () => {
    db.playoffBracketChallenge.create.mockResolvedValue({ id: "cup", name: "Friends Cup" })
    await expect(createPlayoffBracketChallenge({ sport: "nba_cup", seasonYear: 2026, user: { id: "user" } })).resolves.toMatchObject({ challengeId: "cup" })
    db.playoffBracketChallenge.findUnique.mockResolvedValue({ ...challenge, series: [{ startsAt: null }, { startsAt: new Date("2026-10-30T00:00:00Z") }] })
    await expect(createPlayoffBracketEntry({ challengeId: "cup", user: { id: "user" } })).resolves.toMatchObject({ entryId: "entry-new" })
  })
  it("saves an upcoming pick after group play began without clearing locked picks or finalization", async () => {
    await expect(savePlayoffBracketPick(input)).resolves.toMatchObject({ id: "pick" })
    expect(db.playoffBracketPick.deleteMany).not.toHaveBeenCalled()
    expect(db.playoffBracketEntry.update).not.toHaveBeenCalled()
  })
  it("keeps a previously confirmed pick while saving a different draft", async () => {
    db.playoffBracketPick.findUnique.mockResolvedValue({ pickTeamName: "Charlotte Hornets", confirmedAt: new Date("2026-10-29T00:00:00Z") })
    await savePlayoffBracketPick(input)
    expect(db.playoffBracketPick.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { draftTeamName: "Boston Celtics" },
    }))
  })
  it("asks older clients to refresh instead of silently changing their save semantics", async () => {
    await expect(savePlayoffBracketPick({ ...input, confirmationMode: undefined })).rejects.toThrow(/refresh/i)
    expect(db.playoffBracketPick.upsert).not.toHaveBeenCalled()
  })
  it("finalizes only the requested day after every open game has a pick", async () => {
    db.playoffBracketEntry.findUnique.mockResolvedValue({ id: "entry", userId: "user", challengeId: "cup", challenge })
    db.playoffBracketSeries.findMany.mockResolvedValue([game, { ...game, id: "other", startsAt: new Date("2026-11-08T00:00:00Z") }])
    db.playoffBracketPick.findMany.mockResolvedValue([{ id: "pick", seriesId: "future", pickTeamName: "Charlotte Hornets", draftTeamName: "Boston Celtics", confirmedAt: new Date("2026-10-29T00:00:00Z") }])
    await expect(finalizeNbaCupDay({ ...input, day: "2026-11-07", timeZone: "UTC" })).resolves.toMatchObject({ confirmed: 1 })
    expect(db.playoffBracketPick.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "pick" }, data: expect.objectContaining({ pickTeamName: "Boston Celtics", draftTeamName: null }),
    }))
  })
  it("rejects a day with any missing open pick", async () => {
    db.playoffBracketEntry.findUnique.mockResolvedValue({ id: "entry", userId: "user", challengeId: "cup", challenge })
    db.playoffBracketSeries.findMany.mockResolvedValue([game, { ...game, id: "second" }])
    db.playoffBracketPick.findMany.mockResolvedValue([{ id: "pick", seriesId: "future", pickTeamName: "Boston Celtics" }])
    await expect(finalizeNbaCupDay({ ...input, day: "2026-11-07", timeZone: "UTC" })).rejects.toThrow(/every open game/)
    expect(db.playoffBracketPick.update).not.toHaveBeenCalled()
  })
  it("uses the viewer's local date and does not change a locked confirmed pick", async () => {
    db.playoffBracketEntry.findUnique.mockResolvedValue({ id: "entry", userId: "user", challengeId: "cup", challenge })
    db.playoffBracketSeries.findMany.mockResolvedValue([game, { ...game, id: "locked", startsAt: new Date("2026-10-30T23:00:00Z"), status: "final" }])
    db.playoffBracketPick.findMany.mockResolvedValue([{ id: "pick", seriesId: "future", pickTeamName: "Boston Celtics", confirmedAt: null }])
    await expect(finalizeNbaCupDay({ ...input, day: "2026-11-06", timeZone: "America/New_York" })).resolves.toMatchObject({ confirmed: 1 })
    expect(db.playoffBracketPick.update).toHaveBeenCalledTimes(1)
    expect(db.playoffBracketPick.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "pick" } }))
  })
  it("cannot finalize another user's day", async () => {
    db.playoffBracketEntry.findUnique.mockResolvedValue({ id: "entry", userId: "other", challengeId: "cup", challenge })
    await expect(finalizeNbaCupDay({ ...input, day: "2026-11-07", timeZone: "UTC" })).rejects.toThrow(/Entry not found/)
    expect(db.playoffBracketPick.update).not.toHaveBeenCalled()
  })
  it("rejects past picks even for the pool owner and an override config", async () => {
    db.playoffBracketSeries.findUnique.mockResolvedValue({ ...game, startsAt: new Date("2026-10-30T23:00:00Z") })
    await expect(savePlayoffBracketPick(input)).rejects.toThrow(/locked/)
    expect(db.playoffBracketPick.upsert).not.toHaveBeenCalled()
  })
  it("rechecks tipoff inside the saving transaction", async () => {
    db.playoffBracketSeries.findUnique.mockResolvedValueOnce(game).mockResolvedValueOnce({ ...game, status: "in_progress" })
    await expect(savePlayoffBracketPick(input)).rejects.toThrow(/locked/)
    expect(db.playoffBracketPick.upsert).not.toHaveBeenCalled()
  })
  it("finalizes the remaining games while preserving the first submission timestamp", async () => {
    await expect(submitPlayoffBracketEntry({ ...input, tiebreakerTotalScore: 211 })).resolves.toMatchObject({ entryId: "entry" })
    expect(db.playoffBracketEntry.updateMany).toHaveBeenCalledWith({ where: { id: "entry", finalizedAt: null }, data: { finalizedAt: expect.any(Date) } })
    expect(db.playoffBracketEntry.update).toHaveBeenCalledWith({ where: { id: "entry" }, data: { tiebreakerTotalScore: 211 } })
  })

  it("finalizes Cup picks without requiring or replacing a championship guess", async () => {
    await expect(submitPlayoffBracketEntry(input)).resolves.toMatchObject({ entryId: "entry" })
    expect(db.playoffBracketEntry.updateMany).toHaveBeenCalledWith({ where: { id: "entry", finalizedAt: null }, data: { finalizedAt: expect.any(Date) } })
    expect(db.playoffBracketEntry.update).not.toHaveBeenCalled()
  })
  it("preserves the CFP first-game lock", async () => {
    db.playoffBracketSeries.findUnique.mockResolvedValue({ ...game, challenge: { ...challenge, sport: "ncaaf" } })
    await expect(savePlayoffBracketPick(input)).rejects.toThrow(/first game/)
  })
})
