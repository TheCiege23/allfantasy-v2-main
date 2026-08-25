import { beforeEach, describe, expect, it, vi } from "vitest"

import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"
const getServerSessionMock = vi.fn()
const runAiProtectionMock = vi.fn()
const enrichChatWithDataMock = vi.fn()
const runUnifiedOrchestrationMock = vi.fn()
const requestContractToUnifiedMock = vi.fn()
const unifiedResponseToContractMock = vi.fn()
const validateToolRequestMock = vi.fn()
const buildChimmyConversationIdMock = vi.fn()
const buildAgentPromptMock = vi.fn()
const inferAgentFromMessageMock = vi.fn()
const getChimmyMemoryContextMock = vi.fn()
const resolveNormalizedLeagueContextMock = vi.fn()
const resolveChimmyPersonalizationProfileMock = vi.fn()
const resolveChimmyLeagueSelectionMock = vi.fn()
const detectManagerAmbiguityMock = vi.fn()
const buildChimmyStalenessWarningMock = vi.fn()
const buildChimmySourceReferencesMock = vi.fn()
const buildChimmySportDataDigestMock = vi.fn()
const prismaUserProfileFindUniqueMock = vi.fn()
const prismaUserProfileUpsertMock = vi.fn()
const prismaAppUserFindUniqueMock = vi.fn()
const prismaAiCustomRuleFindManyMock = vi.fn()
/*
 * League grounding. These were absent, so `prisma.league` was `undefined`, the
 * snapshot loader threw, and the route swallowed it and answered anyway — which
 * is exactly the production bug this fixture now has to be able to express. With
 * the models present, "grounded" and "not grounded" are both reachable states.
 */
const prismaLeagueFindUniqueMock = vi.fn()
const prismaRedraftMemberFindUniqueMock = vi.fn()
const prismaRosterCountMock = vi.fn()
const prismaLeagueTeamFindFirstMock = vi.fn()
const previewSpendMock = vi.fn()
const spendTokensForRuleMock = vi.fn()
const refundSpendByLedgerMock = vi.fn()
vi.mock("next-auth", () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}))

vi.mock("@/lib/ai-protection", () => ({
  runAiProtection: runAiProtectionMock,
}))

vi.mock("@/lib/chat-data-enrichment", () => ({
  enrichChatWithData: enrichChatWithDataMock,
}))

vi.mock("@/lib/ai-orchestration/orchestration-service", () => ({
  runUnifiedOrchestration: runUnifiedOrchestrationMock,
}))

vi.mock("@/lib/ai-tool-registry", () => ({
  requestContractToUnified: requestContractToUnifiedMock,
  unifiedResponseToContract: unifiedResponseToContractMock,
  validateToolRequest: validateToolRequestMock,
}))

vi.mock("@/lib/ai-simulation-integration", () => ({
  getInsightBundle: vi.fn(),
}))

vi.mock("@/lib/sport-scope", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    normalizeToSupportedSport: (value?: string | null) => value ?? "NFL",
  }
})

vi.mock("@/lib/league-context-engine", () => ({
  resolveNormalizedLeagueContext: resolveNormalizedLeagueContextMock,
}))

vi.mock("@/lib/ai-memory/chimmy-memory-context", () => ({
  getChimmyMemoryContext: getChimmyMemoryContextMock,
}))

vi.mock("@/lib/ai-memory/chat-history-store", () => ({
  appendChatHistory: vi.fn(),
  buildChimmyConversationId: buildChimmyConversationIdMock,
}))

vi.mock("@/lib/ai-memory/ai-memory-store", () => ({
  rememberChimmyAssistantMemory: vi.fn(),
  rememberChimmyUserMessageMemory: vi.fn(),
  getAiMemory: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/agents/pipeline", () => ({
  buildAgentPrompt: buildAgentPromptMock,
  inferAgentFromMessage: inferAgentFromMessageMock,
}))

vi.mock("@/lib/tokens/TokenSpendService", () => ({
  TokenInsufficientBalanceError: class TokenInsufficientBalanceError extends Error {},
  TokenSpendConfirmationRequiredError: class TokenSpendConfirmationRequiredError extends Error {},
  TokenSpendRuleNotFoundError: class TokenSpendRuleNotFoundError extends Error {},
  TokenSpendService: class {
    previewSpend = previewSpendMock
    spendTokensForRule = spendTokensForRuleMock
    refundSpendByLedger = refundSpendByLedgerMock
  },
}))

vi.mock("@/lib/chimmy-personalization/service", () => ({
  resolveChimmyPersonalizationProfile: resolveChimmyPersonalizationProfileMock,
}))

vi.mock("@/lib/chimmy/chimmy-league-resolution", () => ({
  resolveChimmyLeagueSelection: resolveChimmyLeagueSelectionMock,
  detectManagerAmbiguity: detectManagerAmbiguityMock,
  buildChimmyStalenessWarning: buildChimmyStalenessWarningMock,
  buildChimmySourceReferences: buildChimmySourceReferencesMock,
}))

vi.mock("@/lib/chimmy/chimmy-sport-data-digest", () => ({
  buildChimmySportDataDigest: buildChimmySportDataDigestMock,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appUser: { findUnique: prismaAppUserFindUniqueMock },
    userProfile: {
      findUnique: prismaUserProfileFindUniqueMock,
      upsert: prismaUserProfileUpsertMock,
    },
    aICustomRule: { findMany: prismaAiCustomRuleFindManyMock },
    league: { findUnique: prismaLeagueFindUniqueMock },
    redraftLeagueMember: { findUnique: prismaRedraftMemberFindUniqueMock },
    roster: { count: prismaRosterCountMock },
    leagueTeam: { findFirst: prismaLeagueTeamFindFirstMock },
  },
}))

function buildMultipartRequest(formData?: FormData) {
  return createMockNextRequest("http://localhost/api/chat/chimmy", {
    method: "POST",
    body: formData ?? new FormData(),
  })
}

describe("POST /api/chat/chimmy contract", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: "user-1" } })
    runAiProtectionMock.mockResolvedValue(null)
    enrichChatWithDataMock.mockResolvedValue({
      context: "League context loaded",
      audit: { sourcesUsed: ["league_snapshot"] },
    })
    validateToolRequestMock.mockReturnValue({ valid: true })
    buildChimmyConversationIdMock.mockReturnValue("conversation-1")
    buildAgentPromptMock.mockImplementation(async ({ userMessage }: { userMessage: string }) => userMessage)
    inferAgentFromMessageMock.mockReturnValue("trade_analyzer")
    getChimmyMemoryContextMock.mockResolvedValue({ promptSection: "" })
    resolveNormalizedLeagueContextMock.mockResolvedValue({ ok: true, context: {} })
    resolveChimmyPersonalizationProfileMock.mockResolvedValue(null)
    resolveChimmyLeagueSelectionMock.mockResolvedValue({
      kind: "ask",
      message: "Which league do you want me to use for this question?",
      choices: [],
      leagues: [],
    })
    detectManagerAmbiguityMock.mockReturnValue({ kind: "ok" })
    buildChimmyStalenessWarningMock.mockReturnValue({
      warning: null,
      staleMinutes: 1,
      thresholdMinutes: 10,
    })
    buildChimmySourceReferencesMock.mockReturnValue([])
    buildChimmySportDataDigestMock.mockResolvedValue({ text: "", sources: [] })
    prismaAppUserFindUniqueMock.mockResolvedValue({ emailVerified: new Date("2025-01-01") })
    prismaUserProfileUpsertMock.mockResolvedValue({
      userId: "user-1",
      displayName: null,
      phone: null,
      phoneVerifiedAt: null,
      emailVerifiedAt: null,
      ageConfirmedAt: new Date("2025-01-01"),
      profileComplete: true,
    })
    prismaUserProfileFindUniqueMock.mockResolvedValue(null)
    prismaAiCustomRuleFindManyMock.mockResolvedValue([])
    /*
     * `user-1` OWNS `league-1`, so membership resolves on the first check. One
     * mock serves both reads: `resolveLeagueMembership` selects {id, sport,
     * userId} and the snapshot selects the descriptive columns.
     */
    prismaLeagueFindUniqueMock.mockResolvedValue({
      id: "league-1",
      userId: "user-1",
      name: "Kings League",
      sport: "nfl",
      platform: "sleeper",
      platformLeagueId: "1234567890",
      season: 2026,
      leagueSize: 12,
      scoring: "ppr",
      leagueVariant: null,
      isDynasty: false,
      status: "in_season",
      timezone: "America/New_York",
      lastSyncedAt: new Date("2026-08-25T00:00:00.000Z"),
      importBatchId: null,
      importedAt: null,
    })
    prismaRedraftMemberFindUniqueMock.mockResolvedValue(null)
    prismaRosterCountMock.mockResolvedValue(0)
    prismaLeagueTeamFindFirstMock.mockResolvedValue(null)
    previewSpendMock.mockResolvedValue({
      ruleCode: "ai_chimmy_chat_message",
      tokenCost: 15,
      canSpend: true,
      currentBalance: 20,
    })
    spendTokensForRuleMock.mockResolvedValue({
      id: "ledger-1",
      balanceAfter: 5,
    })
    refundSpendByLedgerMock.mockResolvedValue(null)
    requestContractToUnifiedMock.mockReturnValue({ envelope: {} })
    unifiedResponseToContractMock.mockReturnValue({
      aiExplanation: "Accept the trade.",
      actionPlan: "Send the offer now.",
      confidence: 84,
      uncertainty: null,
      providerResults: [],
      reliability: null,
      debugTrace: {
        providerUsed: "openai",
      },
    })
    runUnifiedOrchestrationMock.mockResolvedValue({
      ok: true,
      response: {
        modelOutputs: [
          {
            model: "openai",
            modelName: "gpt-4o-mini",
            raw: "Accept the trade.",
            skipped: false,
            tokensPrompt: 120,
            tokensCompletion: 45,
          },
        ],
      },
    })
  })

  it("returns 401 when unauthenticated", async () => {
    getServerSessionMock.mockResolvedValueOnce(null)

    const { POST } = await import("@/app/api/chat/chimmy/route")
    const res = await POST(buildMultipartRequest() as any)

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" })
  })

  it("returns rate limit response from AI protection", async () => {
    runAiProtectionMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "60" },
      })
    )

    const { POST } = await import("@/app/api/chat/chimmy/route")
    const res = await POST(buildMultipartRequest() as any)

    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("60")
    await expect(res.json()).resolves.toEqual({ error: "Too many requests" })
  })

  it("returns 400 for malformed conversation JSON", async () => {
    const formData = new FormData()
    formData.append("message", "Should I trade for this player?")
    formData.append("messages", "{not json")

    const { POST } = await import("@/app/api/chat/chimmy/route")
    const res = await POST(buildMultipartRequest(formData) as any)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: "Conversation payload must be valid JSON.",
    })
  })

  it("returns 400 for invalid numeric fields", async () => {
    const formData = new FormData()
    formData.append("message", "How should I set my lineup?")
    formData.append("week", "abc")

    const { POST } = await import("@/app/api/chat/chimmy/route")
    const res = await POST(buildMultipartRequest(formData) as any)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: "Invalid request format.",
      details: {
        fieldErrors: {
          week: expect.any(Array),
        },
      },
    })
  })

  it("returns 400 when multipart image payload cannot be parsed", async () => {
    const formData = new FormData()
    formData.append("message", "Analyze this screenshot")
    formData.append("image", new File(["hello"], "notes.txt", { type: "text/plain" }))

    const { POST } = await import("@/app/api/chat/chimmy/route")
    const res = await POST(buildMultipartRequest(formData) as any)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: "Invalid request format." })
  })

  it("returns 400 when multipart screenshot upload cannot be parsed", async () => {
    const originalAiIntegrationsKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY
    const originalOpenAiKey = process.env.OPENAI_API_KEY
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY

    try {
      const formData = new FormData()
      formData.append("message", "Analyze this screenshot")
      formData.append("confirmTokenSpend", "true")
      formData.append("image", new File(["fake-image"], "screenshot.png", { type: "image/png" }))

      const { POST } = await import("@/app/api/chat/chimmy/route")
      const res = await POST(buildMultipartRequest(formData) as any)

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({ error: "Invalid request format." })
      expect(runUnifiedOrchestrationMock).not.toHaveBeenCalled()
    } finally {
      if (originalAiIntegrationsKey == null) {
        delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY
      } else {
        process.env.AI_INTEGRATIONS_OPENAI_API_KEY = originalAiIntegrationsKey
      }

      if (originalOpenAiKey == null) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = originalOpenAiKey
      }
    }
  })

  it("returns 400 when message exceeds the maximum length", async () => {
    const formData = new FormData()
    formData.append("message", "x".repeat(4001))

    const { POST } = await import("@/app/api/chat/chimmy/route")
    const res = await POST(buildMultipartRequest(formData) as any)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: "Invalid request format.",
      details: {
        fieldErrors: {
          message: expect.any(Array),
        },
      },
    })
  })

  it("continues the Chimmy run when token preview fails", async () => {
    previewSpendMock.mockRejectedValueOnce(new Error("monetization context exploded"))

    const formData = new FormData()
    formData.append("message", "Should I trade this player?")
    formData.append("leagueId", "league-1")

    const { POST } = await import("@/app/api/chat/chimmy/route")
    const res = await POST(buildMultipartRequest(formData) as any)

    expect(res.status).toBe(200)
    expect(spendTokensForRuleMock).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.response).toContain("Accept the trade.")
    expect(body.meta?.answerContract).toMatchObject({
      answerType: "trade",
      recommendation: expect.any(String),
      confidence: {
        level: expect.any(String),
      },
    })
  })

  /*
   * The regression these exist for: the drawer sends a `leagueId` for a league
   * the user can SEE in the scope picker but is not a member of. Grounding
   * returned null, the route answered from general knowledge, and the user got a
   * confident call about a roster nobody had read. A refusal is the correct
   * answer to a question we cannot ground.
   */
  it("refuses instead of answering when the selected league cannot be grounded", async () => {
    // Exists, but owned by somebody else and unclaimed by this user.
    prismaLeagueFindUniqueMock.mockResolvedValue({
      id: "league-1",
      userId: "someone-else",
      sport: "nfl",
    })

    const formData = new FormData()
    formData.append("message", "Should I trade this player?")
    formData.append("leagueId", "league-1")

    const { POST } = await import("@/app/api/chat/chimmy/route")
    const res = await POST(buildMultipartRequest(formData) as any)

    expect(res.status).toBe(412)
    const body = await res.json()
    expect(body.details?.groundingReason).toBe("not_member")
    expect(body.details?.message).toMatch(/not a member/i)
    // A refusal must not bill.
    expect(spendTokensForRuleMock).not.toHaveBeenCalled()
  })

  it("does not bill or answer when the league lookup fails outright", async () => {
    prismaLeagueFindUniqueMock.mockRejectedValue(new Error("connection lost"))

    const formData = new FormData()
    formData.append("message", "Should I trade this player?")
    formData.append("leagueId", "league-1")

    const { POST } = await import("@/app/api/chat/chimmy/route")
    const res = await POST(buildMultipartRequest(formData) as any)

    // 503, not 412: "I could not read it" is a different claim from "you are
    // not in it", and only one of them is worth retrying.
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.details?.groundingReason).toBe("error")
    expect(spendTokensForRuleMock).not.toHaveBeenCalled()
  })

  it("reports what it grounded on so the UI can show it", async () => {
    previewSpendMock.mockResolvedValueOnce({
      ruleCode: "ai_chimmy_chat_message",
      tokenCost: 0,
      canSpend: true,
      currentBalance: 999999999,
      requiresConfirmation: false,
    })

    const formData = new FormData()
    formData.append("message", "Should I trade this player?")
    formData.append("leagueId", "league-1")

    const { POST } = await import("@/app/api/chat/chimmy/route")
    const res = await POST(buildMultipartRequest(formData) as any)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.meta?.leagueGrounding).toMatchObject({
      grounded: true,
      leagueId: "league-1",
      leagueName: "Kings League",
    })
  })

  it("skips token confirmation when preview does not require confirmation", async () => {
    previewSpendMock.mockResolvedValueOnce({
      ruleCode: "ai_chimmy_chat_message",
      tokenCost: 0,
      canSpend: true,
      currentBalance: 999999999,
      requiresConfirmation: false,
    })

    const formData = new FormData()
    formData.append("message", "Should I trade this player?")
    formData.append("leagueId", "league-1")

    const { POST } = await import("@/app/api/chat/chimmy/route")
    const res = await POST(buildMultipartRequest(formData) as any)

    expect(res.status).toBe(200)
    expect(spendTokensForRuleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmed: false,
        ruleCode: "ai_chimmy_chat_message",
      })
    )
    const body = await res.json()
    expect(body.response).toContain("Accept the trade.")
    expect(body.meta?.mode).toBe("fast_take")
  })

  it("normalizes invalid mode inputs to fast_take and returns mode metadata", async () => {
    const formData = new FormData()
    formData.append("message", "Should I trade this player?")
    formData.append("confirmTokenSpend", "true")
    formData.append("leagueId", "league-1")
    formData.append("assistantMode", "totally_invalid_mode")

    const { POST } = await import("@/app/api/chat/chimmy/route")
    const res = await POST(buildMultipartRequest(formData) as any)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.meta?.mode).toBe("fast_take")
  })

  it("strips raw JSON context blobs from the displayed response text", async () => {
    unifiedResponseToContractMock.mockReturnValueOnce({
      aiExplanation:
        'Deterministic guidance from NFL context: {"contextSnapshot":{"sport":"NFL","week":7}} Start Drake London over Christian Watson this week.',
      actionPlan: "Lock it in before kickoff.",
      confidence: 84,
      uncertainty: null,
      providerResults: [],
      reliability: null,
      debugTrace: {
        providerUsed: "openai",
      },
    })

    const formData = new FormData()
    formData.append("message", "Who should I start?")
    formData.append("confirmTokenSpend", "true")
    formData.append("leagueId", "league-1")

    const { POST } = await import("@/app/api/chat/chimmy/route")
    const res = await POST(buildMultipartRequest(formData) as any)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.response).toContain(
      "Start Drake London over Christian Watson this week."
    )
  })

  it("returns 412 when league-specific request is missing league context", async () => {
    const formData = new FormData()
    formData.append("message", "Should I trade this player?")

    const { POST } = await import("@/app/api/chat/chimmy/route")
    const res = await POST(buildMultipartRequest(formData) as any)

    expect(res.status).toBe(412)
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("League context is required"),
    })
    expect(runUnifiedOrchestrationMock).not.toHaveBeenCalled()
  })

  it("does not require league grounding for global sports calendar questions", async () => {
    buildChimmySportDataDigestMock.mockResolvedValueOnce({
      text: "### NFL — Player news (DB / sports ingest)\n- NFL Draft starts April 30",
      sources: ["player_news_NFL"],
      freshness: {
        overallLastSyncedAt: "2026-04-25T12:00:00.000Z",
        perSource: {
          player_news_NFL: "2026-04-25T12:00:00.000Z",
        },
      },
    })

    const formData = new FormData()
    formData.append("message", "when is the nfl draft?")
    formData.append("confirmTokenSpend", "true")

    const { POST } = await import("@/app/api/chat/chimmy/route")
    const res = await POST(buildMultipartRequest(formData) as any)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.response).toContain("Accept the trade.")
    expect(body.meta?.answerContract).toMatchObject({
      answerType: "draft",
      confidence: {
        level: expect.any(String),
      },
    })
    expect(body.meta?.syncFreshness).toMatchObject({
      referenceTimezone: "America/New_York",
      sportsDigest: {
        overallLastSyncedAt: "2026-04-25T12:00:00.000Z",
        perSource: {
          player_news_NFL: "2026-04-25T12:00:00.000Z",
        },
      },
    })
    expect(runUnifiedOrchestrationMock).toHaveBeenCalled()
  })

  it("returns 412 with league choices when fuzzy league resolution is ambiguous", async () => {
    resolveChimmyLeagueSelectionMock.mockResolvedValueOnce({
      kind: "ambiguous",
      message: "I found multiple league matches. Tell me which exact league to use.",
      choices: [
        {
          leagueId: "league-1",
          leagueName: "Kings League",
          season: 2026,
          platform: "sleeper",
        },
        {
          leagueId: "league-2",
          leagueName: "Kings Legacy",
          season: 2026,
          platform: "espn",
        },
      ],
      leagues: [],
    })

    const formData = new FormData()
    formData.append("message", "what is the draft order in kings?")

    const { POST } = await import("@/app/api/chat/chimmy/route")
    const res = await POST(buildMultipartRequest(formData) as any)

    expect(res.status).toBe(412)
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("League context is required"),
      details: {
        message: "I found multiple league matches. Tell me which exact league to use.",
        choices: [
          expect.objectContaining({ leagueId: "league-1", leagueName: "Kings League" }),
          expect.objectContaining({ leagueId: "league-2", leagueName: "Kings Legacy" }),
        ],
      },
    })
    expect(runUnifiedOrchestrationMock).not.toHaveBeenCalled()
  })
})
