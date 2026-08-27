import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_WORLD_CUP_SCORING } from "@/lib/world-cup/worldCupBracketBuilder"
import type { WorldCupChimmyContext } from "@/lib/world-cup/worldCupChimmyContext"

const appendChatHistoryMock = vi.hoisted(() => vi.fn())
const buildChimmyConversationIdMock = vi.hoisted(() => vi.fn())
const routeTextCallMock = vi.hoisted(() => vi.fn())
const tryDeterministicAnswerMock = vi.hoisted(() => vi.fn())

vi.mock("server-only", () => ({}))

vi.mock("@/lib/ai-memory/chat-history-store", () => ({
  appendChatHistory: appendChatHistoryMock,
  buildChimmyConversationId: buildChimmyConversationIdMock,
}))

vi.mock("@/lib/ai/providerRouter", () => ({
  routeTextCall: routeTextCallMock,
}))

// generateWorldCupChimmyPrivateReply writes an audit row via logAiInteraction.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiInteractionLog: {
      create: vi.fn().mockResolvedValue({ id: "audit-1" }),
    },
  },
}))

vi.mock("@/lib/ai/deterministic", () => ({
  DETERMINISTIC_SOURCE: "deterministic",
  tryDeterministicAnswer: tryDeterministicAnswerMock,
}))

function baseContext(): WorldCupChimmyContext {
  return {
    challengeId: "c1",
    poolName: "World Cup Pool",
    isLocked: false,
    lockReason: null,
    participantCount: 2,
    entryCount: 2,
    finalizedEntryCount: 1,
    inviteCount: 0,
    scoring: { ...DEFAULT_WORLD_CUP_SCORING },
    userRole: "participant",
    commissionerSettings: null,
    entry: null,
    liveMatches: [],
    upcomingMatches: [],
    recentMatches: [],
    groupStandings: [],
    leaderboard: [
      {
        rank: 1,
        entryId: "e1",
        entryName: "Leader",
        userId: "u1",
        totalScore: 100,
        maxPossibleScore: 400,
        championPickName: "Brazil",
      },
    ],
    liveDataStatus: "unavailable",
    lastSyncedAt: null,
    locale: "en",
    fetchedAt: "2026-06-06T12:00:00.000Z",
  }
}

describe("World Cup Chimmy private reply helper", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    buildChimmyConversationIdMock.mockReturnValue("chimmy:user-1:world-cup:c1")
    appendChatHistoryMock.mockResolvedValue(undefined)
    tryDeterministicAnswerMock.mockResolvedValue(null)
    routeTextCallMock.mockResolvedValue({
      ok: true,
      text: "Lean toward a safer group winner path.",
      model: "gpt-test",
      provider: "openai",
      tokensUsed: 10,
    })
  })

  it("generates a private World Cup reply and persists prompt/response to Chimmy history", async () => {
    const { generateWorldCupChimmyPrivateReply } = await import("@/lib/world-cup/worldCupChimmyPrivateReply")

    const result = await generateWorldCupChimmyPrivateReply({
      userId: "user-1",
      challengeId: "c1",
      challengeName: "World Cup Pool",
      prompt: "@chimmy who should I pick?",
      context: baseContext(),
    })

    expect(result).toMatchObject({
      reply: "Lean toward a safer group winner path.",
      conversationId: "chimmy:user-1:world-cup:c1",
      provider: "openai",
      model: "gpt-test",
    })
    expect(routeTextCallMock).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "system", content: expect.stringContaining("World Cup bracket pool analyst") }),
        expect.objectContaining({ role: "user", content: expect.stringContaining("who should I pick?") }),
      ]),
      skipCache: true,
    }))
    expect(JSON.stringify(routeTextCallMock.mock.calls)).not.toMatch(/sk-|OPENAI_API_KEY/i)
    expect(appendChatHistoryMock).toHaveBeenCalledTimes(2)
    expect(appendChatHistoryMock).toHaveBeenCalledWith(expect.objectContaining({
      role: "user",
      content: "who should I pick?",
      meta: expect.objectContaining({ source: "world_cup_pool_chat", challengeId: "c1" }),
    }))
    expect(appendChatHistoryMock).toHaveBeenCalledWith(expect.objectContaining({
      role: "assistant",
      content: "Lean toward a safer group winner path.",
      meta: expect.objectContaining({ source: "world_cup_pool_chat", provider: "openai" }),
    }))
  })

  it("answers general sports questions in the World Cup bubble from deterministic sports grounding", async () => {
    tryDeterministicAnswerMock.mockResolvedValue(
      "Yes - New York Knicks beat Boston Celtics 101-99. Final. Source: cached SportsGame row."
    )

    const { generateWorldCupChimmyPrivateReply } = await import("@/lib/world-cup/worldCupChimmyPrivateReply")

    const result = await generateWorldCupChimmyPrivateReply({
      userId: "user-1",
      challengeId: "c1",
      challengeName: "World Cup Pool",
      prompt: "@chimmy did the Knicks win last night?",
    })

    expect(routeTextCallMock).not.toHaveBeenCalled()
    expect(result.provider).toBe("deterministic")
    expect(result.model).toBe("sports-cache")
    expect(result.reply).toContain("Knicks")
    expect(result.reply).toContain("101-99")
  })

  it("answers global World Cup start questions instead of falling into missing pool schedule refusal", async () => {
    tryDeterministicAnswerMock.mockResolvedValue(
      "The 2026 FIFA World Cup is scheduled to start on June 11, 2026."
    )

    const { generateWorldCupChimmyPrivateReply } = await import("@/lib/world-cup/worldCupChimmyPrivateReply")

    const result = await generateWorldCupChimmyPrivateReply({
      userId: "user-1",
      challengeId: "c1",
      challengeName: "World Cup Pool",
      prompt: "@chimmy when does the World Cup start?",
    })

    expect(routeTextCallMock).not.toHaveBeenCalled()
    expect(result.model).toBe("sports-cache")
    expect(result.reply).toContain("June 11, 2026")
  })
})
