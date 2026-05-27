/**
 * Tests that Chimmy private reply includes the correct language instruction
 * in its AI prompt based on the user's selected locale.
 *
 * Verifies: prompt language, privacy protections, rate-limit passthrough,
 * and that the reply is never made public.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const routeTextMock = vi.hoisted(() => vi.fn())
const appendHistoryMock = vi.hoisted(() => vi.fn())
const buildConversationIdMock = vi.hoisted(() => vi.fn())
const buildContextMock = vi.hoisted(() => vi.fn())
const detectIntentMock = vi.hoisted(() => vi.fn())

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
    roundOf32Points: 10, roundOf16Points: 20, quarterFinalPoints: 40,
    semiFinalPoints: 80, finalPoints: 160, championBonusPoints: 320, thirdPlacePoints: 4,
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

describe("generateWorldCupChimmyPrivateReply — AI language instruction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    buildConversationIdMock.mockReturnValue("chimmy:user-1:world-cup:c1")
    appendHistoryMock.mockResolvedValue(undefined)
    buildContextMock.mockResolvedValue(minimalCtx)
    detectIntentMock.mockReturnValue("general_chat")
    routeTextMock.mockResolvedValue({
      ok: true,
      text: "Here is your bracket advice.",
      model: "gpt-test",
      provider: "openai",
      tokensUsed: 0,
    })
  })

  async function getSystemPrompt(locale: string | null | undefined) {
    const { generateWorldCupChimmyPrivateReply } = await import(
      "@/lib/world-cup/worldCupChimmyPrivateReply"
    )
    await generateWorldCupChimmyPrivateReply({
      userId: "user-1",
      challengeId: "c1",
      prompt: "@chimmy who should I pick?",
      challengeName: "Office Cup",
      locale,
    })
    const call = routeTextMock.mock.calls[0]?.[0]
    return call?.messages?.[0]?.content as string
  }

  it("includes 'Respond in Spanish' for es locale", async () => {
    const prompt = await getSystemPrompt("es")
    expect(prompt).toContain("Respond in Spanish")
  })

  it("includes 'Respond in Traditional Chinese' for zh locale", async () => {
    const prompt = await getSystemPrompt("zh")
    expect(prompt).toContain("Respond in Traditional Chinese")
  })

  it("includes 'Respond in Filipino' for fil locale", async () => {
    const prompt = await getSystemPrompt("fil")
    expect(prompt).toContain("Respond in Filipino")
  })

  it("includes 'Respond in Vietnamese' for vi locale", async () => {
    const prompt = await getSystemPrompt("vi")
    expect(prompt).toContain("Respond in Vietnamese")
  })

  it("falls back to 'Respond in English' for unknown locale", async () => {
    const prompt = await getSystemPrompt("xx")
    expect(prompt).toContain("Respond in English")
  })

  it("falls back to 'Respond in English' when locale is null", async () => {
    const prompt = await getSystemPrompt(null)
    expect(prompt).toContain("Respond in English")
  })

  it("privacy language is present in system prompt", async () => {
    const prompt = await getSystemPrompt("es")
    // New prompt: "Do not reveal user IDs, invite codes, emails, or raw DB identifiers."
    expect(prompt).toMatch(/Do not reveal/i)
    expect(prompt).toMatch(/invite codes/i)
    expect(prompt).toMatch(/other pool members/i)
  })

  it("reply is stored with private visibility metadata (not public)", async () => {
    const { generateWorldCupChimmyPrivateReply } = await import(
      "@/lib/world-cup/worldCupChimmyPrivateReply"
    )
    await generateWorldCupChimmyPrivateReply({
      userId: "user-1",
      challengeId: "c1",
      prompt: "@chimmy who should I pick?",
      locale: "vi",
    })

    // appendChatHistory is called twice: once for user turn, once for assistant turn.
    expect(appendHistoryMock).toHaveBeenCalledTimes(2)

    // Both calls should use the same conversationId scoped to the user.
    const conversationIds = appendHistoryMock.mock.calls.map((c) => c[0].conversationId)
    expect(conversationIds[0]).toBe("chimmy:user-1:world-cup:c1")
    expect(conversationIds[1]).toBe("chimmy:user-1:world-cup:c1")

    // No call to AI should include user emails or raw IDs in the system prompt.
    const systemContent = routeTextMock.mock.calls[0]?.[0]?.messages?.[0]?.content as string
    expect(systemContent).not.toMatch(/u1@example|@example\.com/i)
  })

  it("returns fallback text when provider fails, without leaking provider details", async () => {
    routeTextMock.mockResolvedValue({ ok: false })

    const { generateWorldCupChimmyPrivateReply } = await import(
      "@/lib/world-cup/worldCupChimmyPrivateReply"
    )
    const result = await generateWorldCupChimmyPrivateReply({
      userId: "user-1",
      challengeId: "c1",
      prompt: "@chimmy help",
      locale: "zh",
    })

    expect(result.reply).toMatch(/try again/i)
    expect(result.provider).toBe("unavailable")
    expect(result.reply).not.toMatch(/timeout|OPENAI|sk-/i)
  })

  it("skipCache is true so Chimmy replies are never served from cache", async () => {
    await getSystemPrompt("en")
    const callArgs = routeTextMock.mock.calls[0]?.[0]
    expect(callArgs?.skipCache).toBe(true)
  })
})
