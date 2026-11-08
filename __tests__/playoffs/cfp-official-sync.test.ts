import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ prior: vi.fn(), save: vi.fn(), sweep: vi.fn(), pools: vi.fn(), series: vi.fn(), update: vi.fn(), upsert: vi.fn(), previousSchedule: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { playoffBracketChallenge: { findMany: mocks.pools }, playoffBracketSeries: { findMany: mocks.series }, $transaction: async (fn: any) => fn({ playoffBracketSeries: { updateMany: mocks.update }, sportsDataCache: { create: mocks.upsert } }) } }))
vi.mock("@/lib/playoffs/cfpSeedAdmin", () => ({ saveCfpSeedsAndApply: mocks.save }))
vi.mock("@/lib/playoffs/playoffSeeding", () => ({ applyPlayoffSeedsToChallenges: mocks.sweep }))
vi.mock("@/lib/playoffs/cfpSeeds", async (load) => ({ ...(await load<typeof import("@/lib/playoffs/cfpSeeds")>()), readCfpSeeds: mocks.prior }))
vi.mock("@/lib/playoffs/singleGameSchedule", async (load) => ({ ...(await load<typeof import("@/lib/playoffs/singleGameSchedule")>()), readSingleGameSchedule: mocks.previousSchedule }))

import { parseOfficialCfpField, syncCfpOfficialField } from "@/lib/playoffs/syncCfpOfficialField"

const teams = ["Oregon", "Georgia", "Boise State", "Arizona State", "Texas", "Penn State", "Notre Dame", "Ohio State", "Tennessee", "Indiana", "SMU", "Clemson"]
const game = (id: number, slots: any[]) => ({ id, slots, startDate: "2099-01-01T00:00:00.000Z", bowlName: `CFP game ${id}` })
const seed = (n: number) => ({ seed: n })
const source = (id: number) => ({ source: { matchupId: id } })
const field = { season: 2024, competition: "cfp", status: "selected", teamCount: 12,
  participants: teams.map((school, i) => ({ seed: i + 1, team: { school } })).reverse(), rounds: [
    { code: "first_round", matchups: [game(2,[seed(5),seed(12)]),game(1,[seed(8),seed(9)]),game(4,[seed(6),seed(11)]),game(3,[seed(7),seed(10)])] },
    { code: "quarterfinal", matchups: [game(5,[seed(1),source(1)]),game(6,[seed(4),source(2)]),game(7,[seed(2),source(3)]),game(8,[seed(3),source(4)])] },
    { code: "semifinal", matchups: [game(9,[source(5),source(6)]),game(10,[source(7),source(8)])] },
    { code: "championship", matchups: [game(11,[source(9),source(10)])] },
  ] }

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers().setSystemTime(new Date("2024-12-08T18:00:00Z"))
  vi.stubEnv("CFBD_API_KEY", "test-only")
  mocks.prior.mockResolvedValue(null)
  mocks.save.mockResolvedValue({ ok: true, sweep: { errors: [] } })
  mocks.pools.mockResolvedValue([{ id: "one" }])
  mocks.series.mockResolvedValue([])
  mocks.previousSchedule.mockResolvedValue(null)
  mocks.sweep.mockResolvedValue({ errors: [] })
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify(field), { status: 200 })))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe("official CFP field sync", () => {
  it("does not consume provider requests during the regular season", async () => {
    expect(await syncCfpOfficialField({ season: 2026, apply: true, now: new Date("2026-11-08T12:00:00Z") })).toMatchObject({ status: "before-selection-window", ok: true })
    expect(fetch).not.toHaveBeenCalled()
  })
  it("uses playoff seeds rather than ranking order and requires a complete selected field", () => {
    expect(parseOfficialCfpField(field, 2024)).toEqual(teams)
    expect(parseOfficialCfpField({ ...field, status: "scheduled" }, 2024)).toBeNull()
    expect(parseOfficialCfpField({ ...field, participants: field.participants.slice(1) }, 2024)).toBeNull()
    expect(parseOfficialCfpField({ ...field, participants: [...field.participants.slice(0, 11), field.participants[0]] }, 2024)).toBeNull()
    expect(parseOfficialCfpField(field, 2025)).toBeNull()
  })
  it("does not write before selection or during a preview", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ status: "scheduled" })))
    expect(await syncCfpOfficialField({ season: 2024, apply: true })).toMatchObject({ status: "not-selected", ok: true })
    expect(await syncCfpOfficialField({ season: 2024, apply: false })).toMatchObject({ status: "verified-preview", ok: true })
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
  it("publishes a validated field and retries missed pools without rewriting an existing field", async () => {
    expect(await syncCfpOfficialField({ season: 2024, apply: true })).toMatchObject({ status: "published", ok: true })
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ cacheKey: "NCAAF:cfp_seeds:2024", data: expect.objectContaining({ seeds: teams }) }) }))
    mocks.prior.mockResolvedValue({ seeds: teams })
    expect(await syncCfpOfficialField({ season: 2024, apply: true })).toMatchObject({ status: "current", ok: true })
    expect(mocks.sweep).toHaveBeenCalledWith(["one"])
  })
  it("does not change an existing conflicting field", async () => {
    mocks.prior.mockResolvedValue({ seeds: [...teams].reverse() })
    expect(await syncCfpOfficialField({ season: 2024, apply: true })).toMatchObject({ status: "field-conflict", ok: false })
    expect(mocks.upsert).not.toHaveBeenCalled()
    expect(mocks.sweep).not.toHaveBeenCalled()
  })
  it("rejects a bracket whose official paths differ from the app's board", async () => {
    const bad = structuredClone(field)
    bad.rounds[1].matchups[0].slots = [seed(1), source(2)]
    vi.mocked(fetch).mockImplementationOnce(async () => new Response(JSON.stringify(bad)))
    expect(await syncCfpOfficialField({ season: 2024, apply: true })).toMatchObject({ status: "unsupported-or-incomplete-bracket", ok: false })
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
  it("preserves existing seeded teams when they conflict with the provider field", async () => {
    mocks.series.mockResolvedValue([{ seriesNumber: 1, startsAt: null, status: "scheduled", homeTeamName: "Another school", awayTeamName: "CFP9" }])
    expect(await syncCfpOfficialField({ season: 2024, apply: true })).toMatchObject({ status: "schedule-conflict", ok: false })
    expect(mocks.upsert).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it("keeps a manually published schedule when its start times disagree", async () => {
    mocks.previousSchedule.mockResolvedValue({ games: [{ startsAt: "2098-12-31T00:00:00.000Z" }], enteredByUserId: "admin" })
    expect(await syncCfpOfficialField({ season: 2024, apply: true })).toMatchObject({ status: "schedule-conflict", ok: false })
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
})
