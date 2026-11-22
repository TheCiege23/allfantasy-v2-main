import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const clientPath = process.env.CUP_DAILY_QA_CLIENT
  const { PrismaClient } = clientPath ? await import(/* @vite-ignore */ clientPath) : await import("@prisma/client")
  const database = process.env.CUP_DAILY_QA_DATABASE ?? "cup_daily_flow_qa_1107"
  if (!/^cup_daily_flow_qa_\d+$/.test(database)) throw new Error("Invalid QA database name")
  return { prisma: new PrismaClient({ datasources: { db: { url: `postgresql://postgres@127.0.0.1:56349/${database}` } } }) }
})
vi.mock("@/lib/auth/admin", () => ({ hasPoolAdminAccess: () => false }))
vi.mock("@/lib/entitlements/afCommissionerPlan", () => ({ hasAfCommissionerPlan: async () => false }))
vi.mock("@/lib/subscription/EntitlementResolver", () => ({ EntitlementResolver: class { async resolveSnapshot() { return {} } } }))
vi.mock("@/lib/subscription/livePlanFlags", () => ({ planFlagsFromSnapshot: () => ({ pro: false }) }))
vi.mock("@/lib/playoffs/teamIntelligence", () => ({ loadBracketTeamProfiles: async () => ({}) }))
vi.mock("@/lib/sport-teams/storedTeamLogos", () => ({ getStoredTeamLogoResolver: async () => () => null }))

import { prisma } from "@/lib/prisma"
import { savePlayoffBracketPick, finalizeNbaCupDay } from "@/lib/playoffs/playoffService"
import { eligibleNbaCupPicks } from "@/lib/playoffs/nbaCupTournament"
import { scoreAndPotential } from "@/lib/playoffs/playoffCompetition"

const db = prisma as any
const gameTime = new Date(Date.now() + 2 * 86400000)
const day = gameTime.toISOString().slice(0, 10)
const input = { challengeId: "daily-pool", entryId: "daily-entry", userId: "daily-user", confirmationMode: "per_day" as const }
describe.skipIf(process.env.CUP_DAILY_INTEGRATION !== "1")("daily NBA Cup confirmation against PostgreSQL", () => {
beforeAll(async () => {
  const guard = await db.$queryRaw`SELECT current_database() AS db, inet_server_port() AS port`
  if (guard[0]?.db !== (process.env.CUP_DAILY_QA_DATABASE ?? "cup_daily_flow_qa_1107") || Number(guard[0]?.port) !== 56349) throw new Error("Wrong QA database")
  await db.playoffBracketChallenge.create({ data: { id: input.challengeId, ownerUserId: input.userId, name: "Synthetic daily QA", sport: "nba_cup", seasonYear: 2097, isTestMode: false } })
  await db.playoffBracketEntry.create({ data: { id: input.entryId, challengeId: input.challengeId, userId: input.userId, name: "Synthetic daily entry", finalizedAt: new Date(Date.now()-86400000) } })
  await db.playoffBracketSeries.createMany({ data: [
    { id: "daily-a", challengeId: input.challengeId, round: "cup_group_play", roundIndex: 0, seriesNumber: 1, conference: "east", homeSeed: 1, awaySeed: 2, homeTeamName: "Boston Celtics", awayTeamName: "New York Knicks", bestOf: 1, startsAt: gameTime },
    { id: "daily-b", challengeId: input.challengeId, round: "cup_group_play", roundIndex: 0, seriesNumber: 2, conference: "west", homeSeed: 1, awaySeed: 2, homeTeamName: "Los Angeles Lakers", awayTeamName: "Phoenix Suns", bestOf: 1, startsAt: gameTime },
  ] })
  await db.playoffBracketPick.create({ data: { id: "daily-confirmed", challengeId: input.challengeId, entryId: input.entryId, seriesId: "daily-a", pickTeamName: "Boston Celtics", confirmedAt: new Date(Date.now()-86400000) } })
})
afterAll(async () => { await db.$disconnect() })
  it("preserves the confirmed choice until all of the day is finalized and then scores the confirmed winner", async () => {
    await savePlayoffBracketPick({ ...input, seriesId: "daily-a", pickTeamName: "New York Knicks" })
    let first = await db.playoffBracketPick.findUnique({ where: { id: "daily-confirmed" } })
    expect(first).toMatchObject({ pickTeamName: "Boston Celtics", draftTeamName: "New York Knicks" })
    const hypothetical = await db.playoffBracketSeries.findMany({ where: { challengeId: input.challengeId } })
    hypothetical.find((game: any) => game.id === "daily-a").winnerTeamName = "Boston Celtics"
    expect(scoreAndPotential(hypothetical, eligibleNbaCupPicks(hypothetical, [first], new Date(Date.now()-86400000)), "nba_cup")).toMatchObject({ totalScore: 1 })
    await expect(finalizeNbaCupDay({ ...input, day, timeZone: "UTC" })).rejects.toThrow(/every open game/)
    first = await db.playoffBracketPick.findUnique({ where: { id: "daily-confirmed" } })
    expect(first).toMatchObject({ pickTeamName: "Boston Celtics", draftTeamName: "New York Knicks" })
    await savePlayoffBracketPick({ ...input, seriesId: "daily-b", pickTeamName: "Los Angeles Lakers" })
    const before = await db.playoffBracketPick.findMany({ where: { entryId: input.entryId } })
    expect(before.find((pick: any) => pick.seriesId === "daily-b").confirmedAt).toBeNull()
    await finalizeNbaCupDay({ ...input, day, timeZone: "UTC" })
    first = await db.playoffBracketPick.findUnique({ where: { id: "daily-confirmed" } })
    expect(first).toMatchObject({ pickTeamName: "New York Knicks", draftTeamName: null, confirmedAt: expect.any(Date) })
    await db.playoffBracketSeries.update({ where: { id: "daily-a" }, data: { status: "final", winnerTeamName: "New York Knicks" } })
    const series = await db.playoffBracketSeries.findMany({ where: { challengeId: input.challengeId } })
    const picks = await db.playoffBracketPick.findMany({ where: { entryId: input.entryId } })
    const confirmed = eligibleNbaCupPicks(series, picks, new Date(Date.now()-86400000))
    expect(scoreAndPotential(series, confirmed, "nba_cup")).toMatchObject({ totalScore: 1, potentialTotal: 2 })
    await expect(savePlayoffBracketPick({ ...input, seriesId: "daily-a", pickTeamName: "Boston Celtics" })).rejects.toThrow(/completed|locked/i)
    const race = await Promise.allSettled([
      savePlayoffBracketPick({ ...input, seriesId: "daily-b", pickTeamName: "Phoenix Suns" }),
      finalizeNbaCupDay({ ...input, day, timeZone: "UTC" }),
    ])
    expect(race[0].status).toBe("fulfilled")
    const second = await db.playoffBracketPick.findUnique({ where: { entryId_seriesId: { entryId: input.entryId, seriesId: "daily-b" } } })
    const coherent = second.pickTeamName === "Phoenix Suns" && second.draftTeamName === null ||
      second.pickTeamName === "Los Angeles Lakers" && second.draftTeamName === "Phoenix Suns"
    expect(coherent).toBe(true)
    const nextTime = new Date(gameTime.getTime() + 86400000)
    await db.playoffBracketSeries.create({ data: { id: "daily-c", challengeId: input.challengeId, round: "cup_group_play", roundIndex: 0, seriesNumber: 3, conference: "east", homeSeed: 1, awaySeed: 2, homeTeamName: "Boston Celtics", awayTeamName: "New York Knicks", bestOf: 1, startsAt: nextTime } })
    await db.playoffBracketPick.create({ data: { id: "daily-c-pick", challengeId: input.challengeId, entryId: input.entryId, seriesId: "daily-c", pickTeamName: "Boston Celtics", confirmedAt: new Date(Date.now()-86400000) } })
    await savePlayoffBracketPick({ ...input, seriesId: "daily-c", pickTeamName: "New York Knicks" })
    await db.playoffBracketSeries.update({ where: { id: "daily-c" }, data: { status: "in_progress" } })
    await expect(finalizeNbaCupDay({ ...input, day: nextTime.toISOString().slice(0, 10), timeZone: "UTC" })).rejects.toThrow(/No open games/)
    expect(await db.playoffBracketPick.findUnique({ where: { id: "daily-c-pick" } })).toMatchObject({ pickTeamName: "Boston Celtics", draftTeamName: "New York Knicks" })
  })
})
