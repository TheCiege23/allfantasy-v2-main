/**
 * Chimmy AI Chat — private-reply integration + i18n chip keys (Phase 9)
 *
 * Covers:
 *  - Short-circuit paths for missing live/schedule data
 *  - System prompt safety rules (PROHIBITED words, no-guess rule, privacy)
 *  - Context block content in user message (scoring, picks, live, timestamp)
 *  - Provider error handling (error not leaked to user)
 *  - Chimmy chip i18n keys (all 5 locales)
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const routeTextMock = vi.hoisted(() => vi.fn())
const appendHistoryMock = vi.hoisted(() => vi.fn())
const buildConversationIdMock = vi.hoisted(() => vi.fn())
const buildContextMock = vi.hoisted(() => vi.fn())
const detectIntentMock = vi.hoisted(() => vi.fn())
const isLiveDataIntentMock = vi.hoisted(() => vi.fn())
const isScheduleIntentMock = vi.hoisted(() => vi.fn())

vi.mock("server-only", () => ({}))

vi.mock("@/lib/ai/providerRouter", () => ({
  routeTextCall: routeTextMock,
}))

vi.mock("@/lib/ai-memory/chat-history-store", () => ({
  appendChatHistory: appendHistoryMock,
  buildChimmyConversationId: buildConversationIdMock,
}))

vi.mock("@/lib/world-cup/worldCupChimmyContext", () => ({
  buildWorldCupChimmyContext: buildContextMock,
}))

vi.mock("@/lib/world-cup/worldCupChimmyIntent", () => ({
  detectChimmyIntent: detectIntentMock,
  isLiveDataIntent: isLiveDataIntentMock,
  isScheduleIntent: isScheduleIntentMock,
}))

// ─── Shared helpers ───────────────────────────────────────────────────────────

const SCORING = {
  roundOf32Points: 10, roundOf16Points: 20, quarterFinalPoints: 40,
  semiFinalPoints: 80, finalPoints: 160, championBonusPoints: 320, thirdPlacePoints: 4,
}

function baseCtx(overrides: Record<string, unknown> = {}) {
  return {
    challengeId: "c1",
    poolName: "Office Cup",
    isLocked: false,
    lockReason: null,
    participantCount: 12,
    scoring: SCORING,
    entry: null,
    liveMatches: [],
    upcomingMatches: [],
    recentMatches: [],
    liveDataStatus: "unavailable" as const,
    lastSyncedAt: null,
    locale: null,
    fetchedAt: new Date().toISOString(),
    ...overrides,
  }
}

// ─── Integration: private reply ───────────────────────────────────────────────

describe("generateWorldCupChimmyPrivateReply — integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    buildConversationIdMock.mockReturnValue("chimmy:u1:world-cup:c1")
    appendHistoryMock.mockResolvedValue(undefined)
    buildContextMock.mockResolvedValue(baseCtx())
    detectIntentMock.mockReturnValue("general_chat")
    isLiveDataIntentMock.mockReturnValue(false)
    isScheduleIntentMock.mockReturnValue(false)
    routeTextMock.mockResolvedValue({
      ok: true, text: "Solid bracket choices overall.",
      model: "gpt-test", provider: "openai", tokensUsed: 0,
    })
  })

  it("short-circuits with unavailable reply when live intent + no live matches (no AI call)", async () => {
    isLiveDataIntentMock.mockReturnValue(true)
    buildContextMock.mockResolvedValue(baseCtx({ liveMatches: [] }))

    const { generateWorldCupChimmyPrivateReply } = await import(
      "@/lib/world-cup/worldCupChimmyPrivateReply"
    )
    const result = await generateWorldCupChimmyPrivateReply({
      userId: "u1", challengeId: "c1", prompt: "What is the score?",
    })

    expect(routeTextMock).not.toHaveBeenCalled()
    expect(result.provider).toBe("deterministic")
    expect(result.model).toBe("short_circuit")
    expect(result.reply).toMatch(/not available|unavailable|FIFA/i)
    expect(result.reply).not.toMatch(/\d–\d/)
  })

  it("short-circuits with no-schedule reply when schedule intent + no upcoming/live matches (no AI call)", async () => {
    isScheduleIntentMock.mockReturnValue(true)
    buildContextMock.mockResolvedValue(baseCtx({ upcomingMatches: [], liveMatches: [] }))

    const { generateWorldCupChimmyPrivateReply } = await import(
      "@/lib/world-cup/worldCupChimmyPrivateReply"
    )
    const result = await generateWorldCupChimmyPrivateReply({
      userId: "u1", challengeId: "c1", prompt: "When does the next game start?",
    })

    expect(routeTextMock).not.toHaveBeenCalled()
    expect(result.provider).toBe("deterministic")
    expect(result.reply).toMatch(/FIFA\.com|schedule|fixture|not available/i)
  })

  it("does NOT short-circuit live intent when live matches ARE present", async () => {
    isLiveDataIntentMock.mockReturnValue(true)
    buildContextMock.mockResolvedValue(baseCtx({
      liveMatches: [{
        matchId: "m1", round: "SF", homeTeamName: "France", awayTeamName: "England",
        homeScore: 1, awayScore: 0, homePenaltyScore: null, awayPenaltyScore: null,
        winnerTeamName: null, status: "live", minute: 60, injuryTime: null,
        startsAt: null, venueName: null, venueCity: null, apiStatusShort: null, lastSyncedAt: null,
      }],
    }))

    const { generateWorldCupChimmyPrivateReply } = await import(
      "@/lib/world-cup/worldCupChimmyPrivateReply"
    )
    await generateWorldCupChimmyPrivateReply({
      userId: "u1", challengeId: "c1", prompt: "What is the score?",
    })

    expect(routeTextMock).toHaveBeenCalled()
  })

  it("system prompt contains PROHIBITED word list", async () => {
    const { generateWorldCupChimmyPrivateReply } = await import(
      "@/lib/world-cup/worldCupChimmyPrivateReply"
    )
    await generateWorldCupChimmyPrivateReply({
      userId: "u1", challengeId: "c1", prompt: "Help me pick",
    })

    const sys: string = routeTextMock.mock.calls[0]?.[0]?.messages?.[0]?.content
    expect(sys).toMatch(/PROHIBITED/i)
    expect(sys).toMatch(/guaranteed/i)
    expect(sys).toMatch(/best bet/i)
    expect(sys).toMatch(/sportsbook/i)
    expect(sys).toMatch(/wager/i)
  })

  it("system prompt contains no-guess-missing-data rule", async () => {
    const { generateWorldCupChimmyPrivateReply } = await import(
      "@/lib/world-cup/worldCupChimmyPrivateReply"
    )
    await generateWorldCupChimmyPrivateReply({
      userId: "u1", challengeId: "c1", prompt: "Help",
    })

    const sys: string = routeTextMock.mock.calls[0]?.[0]?.messages?.[0]?.content
    // Must tell AI not to invent scores
    expect(sys).toMatch(/Do not guess|never invent|ONLY data/i)
  })

  it("system prompt contains privacy language", async () => {
    const { generateWorldCupChimmyPrivateReply } = await import(
      "@/lib/world-cup/worldCupChimmyPrivateReply"
    )
    await generateWorldCupChimmyPrivateReply({
      userId: "u1", challengeId: "c1", prompt: "Help",
    })

    const sys: string = routeTextMock.mock.calls[0]?.[0]?.messages?.[0]?.content
    expect(sys).toMatch(/private user data|invite codes|other pool members/i)
  })

  it("context block includes scoring values in user message", async () => {
    buildContextMock.mockResolvedValue(baseCtx({ scoring: SCORING }))

    const { generateWorldCupChimmyPrivateReply } = await import(
      "@/lib/world-cup/worldCupChimmyPrivateReply"
    )
    await generateWorldCupChimmyPrivateReply({
      userId: "u1", challengeId: "c1", prompt: "How do points work?",
    })

    const userMsg: string = routeTextMock.mock.calls[0]?.[0]?.messages?.[1]?.content
    expect(userMsg).toMatch(/Round of 32.*10 pts/i)
    expect(userMsg).toMatch(/Champion bonus.*320 pts/i)
    expect(userMsg).toContain("POOL CONTEXT")
  })

  it("context block includes user picks (group + knockout) when entry exists", async () => {
    buildContextMock.mockResolvedValue(baseCtx({
      entry: {
        entryId: "e1", entryName: "My Entry", championPick: "Brazil",
        totalScore: 80, maxPossibleScore: 500, rank: 3,
        correctPicks: 4, incorrectPicks: 1, isComplete: false, isLocked: false,
        groupPicks: [
          { rank: 1, teamName: "Brazil", groupKey: "A", groupName: "Group A", isCorrect: true, pointsAwarded: 10 },
        ],
        knockoutPicks: [
          { round: "ROUND_OF_16", homeTeamName: "Brazil", awayTeamName: "Mexico", pickedTeam: "Brazil", isCorrect: null, pointsAwarded: 0 },
        ],
      },
    }))

    const { generateWorldCupChimmyPrivateReply } = await import(
      "@/lib/world-cup/worldCupChimmyPrivateReply"
    )
    await generateWorldCupChimmyPrivateReply({
      userId: "u1", challengeId: "c1", prompt: "How is my bracket?",
    })

    const userMsg: string = routeTextMock.mock.calls[0]?.[0]?.messages?.[1]?.content
    expect(userMsg).toContain("Brazil")
    expect(userMsg).toContain("Champion pick")
    expect(userMsg).toContain("Group A")
    expect(userMsg).toContain("ROUND_OF_16")
    expect(userMsg).toContain("Pool rank: #3")
  })

  it("context block includes LIVE NOW section + last-updated when live data present", async () => {
    const syncedAt = "2026-06-15T18:30:00.000Z"
    buildContextMock.mockResolvedValue(baseCtx({
      liveMatches: [{
        matchId: "m1", round: "SF", homeTeamName: "France", awayTeamName: "England",
        homeScore: 1, awayScore: 0, homePenaltyScore: null, awayPenaltyScore: null,
        winnerTeamName: null, status: "live", minute: 67, injuryTime: null,
        startsAt: "2026-06-15T17:00:00.000Z", venueName: null, venueCity: null,
        apiStatusShort: "2H", lastSyncedAt: syncedAt,
      }],
      lastSyncedAt: syncedAt,
      liveDataStatus: "live" as const,
    }))

    const { generateWorldCupChimmyPrivateReply } = await import(
      "@/lib/world-cup/worldCupChimmyPrivateReply"
    )
    await generateWorldCupChimmyPrivateReply({
      userId: "u1", challengeId: "c1", prompt: "How is the match going?",
    })

    const userMsg: string = routeTextMock.mock.calls[0]?.[0]?.messages?.[1]?.content
    expect(userMsg).toContain("LIVE NOW")
    expect(userMsg).toContain("France")
    expect(userMsg).toContain("Last updated")
    expect(userMsg).toContain("1–0")
  })

  it("provider error is not leaked to user in reply text", async () => {
    routeTextMock.mockResolvedValue({ ok: false })

    const { generateWorldCupChimmyPrivateReply } = await import(
      "@/lib/world-cup/worldCupChimmyPrivateReply"
    )
    const result = await generateWorldCupChimmyPrivateReply({
      userId: "u1", challengeId: "c1", prompt: "Help",
    })

    expect(result.reply).not.toMatch(/routeTextCall|providerRouter|prisma|OPENAI|sk-|API_KEY/i)
    expect(result.provider).toBe("unavailable")
    expect(result.reply).toMatch(/try again/i)
  })

  it("uses temperature 0.4 and maxTokens 500 for the AI call", async () => {
    const { generateWorldCupChimmyPrivateReply } = await import(
      "@/lib/world-cup/worldCupChimmyPrivateReply"
    )
    await generateWorldCupChimmyPrivateReply({
      userId: "u1", challengeId: "c1", prompt: "bracket advice",
    })

    const callArgs = routeTextMock.mock.calls[0]?.[0]
    expect(callArgs?.temperature).toBe(0.4)
    expect(callArgs?.maxTokens).toBe(500)
  })
})

// ─── i18n chip keys ───────────────────────────────────────────────────────────

describe("Chimmy prompt chip — i18n keys", () => {
  const CHIP_KEYS = [
    "wc.chat.chimmy.chip.liveNow",
    "wc.chat.chimmy.chip.playToday",
    "wc.chat.chimmy.chip.myBracket",
    "wc.chat.chimmy.chip.risky",
    "wc.chat.chimmy.chip.poolRank",
    "wc.chat.chimmy.chip.schedule",
  ] as const

  it("all 6 chip keys are present and non-empty in the EN locale", async () => {
    const { makeWcT } = await import("@/lib/world-cup/worldCupI18n")
    const t = makeWcT(null)
    for (const key of CHIP_KEYS) {
      const val = t(key)
      expect(val, `key "${key}" missing or empty`).toBeTruthy()
      expect(val, `key "${key}" falls back to key string`).not.toBe(key)
    }
  })

  it("chip keys have distinct translations in the ES locale", async () => {
    const { makeWcT } = await import("@/lib/world-cup/worldCupI18n")
    const tEs = makeWcT("es")
    const tEn = makeWcT(null)
    // At minimum the liveNow key should differ between EN and ES
    expect(tEs("wc.chat.chimmy.chip.liveNow")).not.toBe(tEn("wc.chat.chimmy.chip.liveNow"))
  })

  it("chip keys are non-empty in ZH locale", async () => {
    const { makeWcT } = await import("@/lib/world-cup/worldCupI18n")
    const t = makeWcT("zh")
    for (const key of CHIP_KEYS) {
      expect(t(key), `key "${key}" missing in zh`).toBeTruthy()
    }
  })

  it("chip keys are non-empty in FIL locale", async () => {
    const { makeWcT } = await import("@/lib/world-cup/worldCupI18n")
    const t = makeWcT("fil")
    for (const key of CHIP_KEYS) {
      expect(t(key), `key "${key}" missing in fil`).toBeTruthy()
    }
  })

  it("chip keys are non-empty in VI locale", async () => {
    const { makeWcT } = await import("@/lib/world-cup/worldCupI18n")
    const t = makeWcT("vi")
    for (const key of CHIP_KEYS) {
      expect(t(key), `key "${key}" missing in vi`).toBeTruthy()
    }
  })
})
