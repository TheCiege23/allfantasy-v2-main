import { beforeEach, describe, expect, it, vi } from "vitest"

const appendChatHistoryMock = vi.hoisted(() => vi.fn())
const buildChimmyConversationIdMock = vi.hoisted(() => vi.fn())
const routeTextMock = vi.hoisted(() => vi.fn())
const buildContextMock = vi.hoisted(() => vi.fn())
const detectIntentMock = vi.hoisted(() => vi.fn())

vi.mock("server-only", () => ({}))

vi.mock("@/lib/ai-memory/chat-history-store", () => ({
  appendChatHistory: appendChatHistoryMock,
  buildChimmyConversationId: buildChimmyConversationIdMock,
}))

vi.mock("@/lib/ai/providerRouter", () => ({
  routeTextCall: routeTextMock,
}))

vi.mock("@/lib/world-cup/worldCupChimmyContext", () => ({
  buildWorldCupChimmyContext: buildContextMock,
}))

vi.mock("@/lib/world-cup/worldCupChimmyIntent", () => ({
  detectChimmyIntent: detectIntentMock,
  isLiveDataIntent: (_: string) => false,
  isScheduleIntent: (_: string) => false,
}))

const minimalCtx = {
  challengeId: "c1",
  poolName: "World Cup Pool",
  isLocked: false,
  lockReason: null,
  participantCount: 0,
  scoring: {
    roundOf32Points: 10,
    roundOf16Points: 20,
    quarterFinalPoints: 40,
    semiFinalPoints: 80,
    finalPoints: 160,
    championBonusPoints: 320,
    thirdPlacePoints: 4,
  },
  entry: null,
  liveMatches: [],
  upcomingMatches: [],
  recentMatches: [],
  liveDataStatus: "unavailable" as const,
  lastSyncedAt: null,
  locale: null,
  fetchedAt: new Date().toISOString(),
}

describe("World Cup Chimmy private reply helper", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    buildChimmyConversationIdMock.mockReturnValue("chimmy:user-1:world-cup:c1")
    buildContextMock.mockResolvedValue(minimalCtx)
    detectIntentMock.mockReturnValue("general_chat")
    routeTextMock.mockResolvedValue({
      ok: true,
      text: "Lean toward a safer group winner path.",
      model: "gpt-test",
      provider: "openai",
      tokensUsed: 0,
    })
  })

  it("generates a private World Cup reply and persists prompt/response to Chimmy history", async () => {
    const { generateWorldCupChimmyPrivateReply } = await import("@/lib/world-cup/worldCupChimmyPrivateReply")

    const result = await generateWorldCupChimmyPrivateReply({
      userId: "user-1",
      challengeId: "c1",
      challengeName: "World Cup Pool",
      prompt: "@chimmy who should I pick?",
    })

    expect(result).toMatchObject({
      reply: "Lean toward a safer group winner path.",
      conversationId: "chimmy:user-1:world-cup:c1",
      provider: "openai",
      model: "gpt-test",
    })
    expect(routeTextMock).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "system", content: expect.stringContaining("private AllFantasy World Cup bracket assistant") }),
        expect.objectContaining({ role: "user", content: expect.stringContaining("who should I pick?") }),
      ]),
      skipCache: true,
    }))
    expect(JSON.stringify(routeTextMock.mock.calls)).not.toMatch(/sk-|OPENAI_API_KEY/i)
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
})
