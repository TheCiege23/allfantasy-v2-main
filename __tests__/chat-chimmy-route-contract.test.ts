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
const getRecentChatHistoryMock = vi.fn()
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
const resolvePairedHalfMock = vi.fn()
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

/*
 * ⚠ `getRecentChatHistory` ADDED WHEN THE ROUTE GAINED A `GET`. Leaving it out is not loud here —
 * the POST suite never reaches it, so all 18 tests stayed green with the mock a function short. It
 * breaks only once a test exercises the history read, which is exactly how a stale double survives
 * a migration: the suite that should catch it is the one that never calls the new code.
 */
vi.mock("@/lib/ai-memory/chat-history-store", () => ({
  appendChatHistory: vi.fn(),
  buildChimmyConversationId: buildChimmyConversationIdMock,
  getRecentChatHistory: getRecentChatHistoryMock,
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

vi.mock("@/lib/core-app/leaguePairing", () => ({
  resolvePairedHalf: resolvePairedHalfMock,
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

// This file imports app/api/chat/chimmy/route.ts — 3,102 lines that pull the orchestration,
// tool-registry, memory and token-service graphs in behind these mocks — and the FIRST test pays
// the whole cold Vite transform for it. Measured alone on this checkout: 13.20s total, of which
// 8.02s is transform, and "returns 401 when unauthenticated" absorbs 11,544ms while every other
// test in the file runs in 1-35ms.
//
// That fits inside the default 30s on an idle machine and does NOT fit on a loaded one: run
// alongside four other files it timed out at 30,032ms, which then cascaded — the next test's
// `mockResolvedValueOnce(429)` was consumed by the still-in-flight call, so it saw 200 and failed
// too. Two red tests, one clock.
//
// So this is a transform-cost timeout, not a logic hang, and the way to tell them apart is that
// the file passes 17/17 in isolation, repeatedly. Same shape and same remedy already recorded in
// slow-draft-try-queue-autopick-integration, commissionerOsRecommendations and
// league-create-defaults-api. File-level rather than on the one slow test, because the cost lands
// on whichever test runs FIRST and that is an ordering detail no annotation should depend on.
vi.setConfig({ testTimeout: 60000 })

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
    resolvePairedHalfMock.mockResolvedValue(null)
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
    /*
     * ⚠ THIS ASSERTED `groundingReason === "not_member"` AND A "not a member"
     * MESSAGE UNTIL THE 2026-09-09 DISCLOSURE FIX, AND THE INVERSION IS THE
     * RECORD. Together those two told a caller that the id addresses a REAL
     * league and that they simply are not in it — an enumeration oracle.
     * `not_member` and `not_found` now read identically to the caller. The
     * distinction is still known internally and still logged; it is no longer
     * published.
     */
    expect(body.details?.groundingReason).toBeUndefined()
    expect(body.details?.leagueId).toBeUndefined()
    expect(body.details?.message).toMatch(/could not open that league/i)
    expect(body.details?.message).not.toMatch(/i can see that league exists/i)
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
    /*
     * Same disclosure fix: the reason code is no longer published. The caller
     * still gets the 503 and a retry message, which is the actionable part.
     */
    expect(body.details?.groundingReason).toBeUndefined()
    expect(body.details?.leagueId).toBeUndefined()
    expect(spendTokensForRuleMock).not.toHaveBeenCalled()
  })

  /*
   * 🛑 CHARGE ON DELIVERY. The route charged before any model ran and refunded only on a THROWN
   * error — but when every provider fails, orchestration returns the deterministic fallback as a
   * normal success, so the user paid for "AI explanation is temporarily unavailable".
   */
  it("refunds the charge when no AI provider answered, and reports it as not charged", async () => {
    runUnifiedOrchestrationMock.mockResolvedValueOnce({
      ok: true,
      response: {
        modelOutputs: [
          { model: "openai", raw: "", error: "429 billing_not_active", skipped: true },
          { model: "grok", raw: "", error: "403 used all available credits", skipped: true },
        ],
      },
    })
    unifiedResponseToContractMock.mockReturnValueOnce({
      aiExplanation: "Deterministic guidance from NFL context: week: 7. AI explanation is temporarily unavailable.",
      actionPlan: null,
      confidence: 30,
      uncertainty: null,
      providerResults: [],
      reliability: null,
      debugTrace: {},
    })
    refundSpendByLedgerMock.mockResolvedValueOnce({ balanceAfter: 20 })

    const formData = new FormData()
    formData.append("message", "Should I trade this player?")
    formData.append("leagueId", "league-1")
    formData.append("confirmTokenSpend", "true")

    const { POST } = await import("@/app/api/chat/chimmy/route")
    const res = await POST(buildMultipartRequest(formData) as any)

    expect(res.status).toBe(200)
    expect(spendTokensForRuleMock).toHaveBeenCalled()
    expect(refundSpendByLedgerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        spendLedgerId: "ledger-1",
        idempotencyKey: "refund:chimmy_chat:ledger-1",
        metadata: expect.objectContaining({ reason: "no_model_answered" }),
      }),
    )
    const body = await res.json()
    expect(body.meta?.tokenSpend).toMatchObject({ tokenCost: 0, balanceAfter: 20, refunded: true, refundReason: "no_model_answered" })
  })

  it("keeps the charge when a model answered", async () => {
    const formData = new FormData()
    formData.append("message", "Should I trade this player?")
    formData.append("leagueId", "league-1")
    formData.append("confirmTokenSpend", "true")

    const { POST } = await import("@/app/api/chat/chimmy/route")
    const res = await POST(buildMultipartRequest(formData) as any)

    expect(res.status).toBe(200)
    expect(refundSpendByLedgerMock).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.meta?.tokenSpend).toMatchObject({ tokenCost: 15, balanceAfter: 5 })
    expect(body.meta?.tokenSpend?.refunded).toBeUndefined()
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

  it("sends the connected rosters the user selected after league authorization", async () => {
    resolvePairedHalfMock.mockResolvedValueOnce({
      linkId: "hub-1",
      franchiseName: "Peach + Cream",
      viewingRole: "pro",
      self: null,
      other: null,
      sides: [
        {
          role: "pro", platform: "sleeper", leagueId: "league-1", name: "Peach Bowl",
          sport: "NFL", season: 2026, teamLabel: "Free SF TEP", avatarUrl: null,
          playerCount: 1, unavailableReason: null, draft: null, activity: null,
          players: [{ id: "100", name: "Lamar Jackson", position: "QB", team: "BAL", imageUrl: null, logoUrl: null }],
        },
        {
          role: "college", platform: "fantrax", leagueId: "college-1", name: "Cream Bowl",
          sport: "NCAAF", season: 2026, teamLabel: "Ciege82", avatarUrl: null,
          playerCount: 1, unavailableReason: null, draft: null, activity: null,
          players: [{ id: "200", name: "Jeremiah Smith", position: "WR", team: "Ohio State", imageUrl: null, logoUrl: null }],
        },
      ],
    })

    const formData = new FormData()
    formData.append("message", "How should I manage my connected rosters?")
    formData.append("leagueId", "league-1")
    formData.append("connectedLeagueIds", JSON.stringify(["league-1", "college-1"]))
    formData.append("confirmTokenSpend", "true")

    const { POST } = await import("@/app/api/chat/chimmy/route")
    const res = await POST(buildMultipartRequest(formData) as any)

    expect(res.status).toBe(200)
    expect(resolvePairedHalfMock).toHaveBeenCalledWith("league-1", "user-1", {
      includeOperationalSummary: false,
    })
    const request = requestContractToUnifiedMock.mock.calls.at(-1)?.[0]
    expect(request?.userMessage).toContain("CONNECTED FRANCHISE ROSTERS")
    expect(request?.userMessage).toContain("Lamar Jackson")
    expect(request?.userMessage).toContain("Jeremiah Smith")
    expect(request?.userMessage).not.toContain('"id":"100"')
    const body = await res.json()
    expect(body.meta?.dataSources).toContain("connected_franchise_rosters")
    expect(body.meta?.connectedFranchise).toEqual([
      expect.objectContaining({ leagueId: "league-1", leagueName: "Peach Bowl", playerCount: 1 }),
      expect.objectContaining({ leagueId: "college-1", leagueName: "Cream Bowl", playerCount: 1 }),
    ])
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
  /*
   * ── GET: the transcript the route has always been writing ─────────────────────────────────
   *
   * Every turn has gone into `chat_history` since PROMPT 234 and nothing ever read it back, so
   * closing the tab lost a conversation the database still held. These cover the seam: who may
   * read, which conversation is read, and what a stored turn is allowed to bring back with it.
   */
  describe("GET — conversation history", () => {
    beforeEach(() => {
      /*
       * ⚠ MIRRORS THE REAL RULE, WHICH STOPPED USING `leagueId` ON 2026-09-20. A fake that still
       * appended the league would keep this suite green while the route it stands in for had
       * changed contract — the mock pinning a rule the code no longer follows.
       */
      buildChimmyConversationIdMock.mockImplementation(
        ({ userId }: { userId?: string | null; leagueId?: string | null }) => `chimmy:${userId}`
      )
      getRecentChatHistoryMock.mockResolvedValue([])
    })

    it("refuses an unauthenticated read", async () => {
      getServerSessionMock.mockResolvedValueOnce(null)
      const { GET } = await import("@/app/api/chat/chimmy/route")
      const res = await GET(createMockNextRequest("http://localhost/api/chat/chimmy") as any)
      expect(res.status).toBe(401)
      expect(getRecentChatHistoryMock).not.toHaveBeenCalled()
    })

    /*
     * 🛑 ONE THREAD, WHATEVER LEAGUE IS ON SCREEN — user's decision 2026-09-20.
     *
     * This used to read the LEAGUE's conversation, which is why "my previous conversation from
     * mobile is not showing up on PC" was reported: the read worked, mobile had simply been in a
     * different league, so it was a different thread.
     *
     * ⚠ THE ASSERTION THAT CATCHES A REGRESSION IS THE REQUEST SHAPE, NOT THE RETURNED TURNS. The
     * mock answers whatever it is asked, so only "scoped by user, with no conversation key" can
     * tell one thread from per-league.
     */
    it("🛑 reads ONE thread for the user, ignoring the league on screen", async () => {
      getRecentChatHistoryMock.mockResolvedValue([
        { role: "user", content: "how is my team doing?", createdAt: new Date("2026-09-20T01:00:00Z"), meta: null, leagueId: "cream-bowl" },
        { role: "assistant", content: "Here is the read.", createdAt: new Date("2026-09-20T01:00:05Z"), meta: null, leagueId: "kbfl" },
      ])
      const { GET } = await import("@/app/api/chat/chimmy/route")
      const res = await GET(
        createMockNextRequest("http://localhost/api/chat/chimmy?leagueId=cream-bowl") as any
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.conversationId).toBe("chimmy:user-1")
      // No conversation key — that omission is what unions the legacy per-league rows.
      expect(getRecentChatHistoryMock).toHaveBeenCalledWith({ userId: "user-1", limit: 80 })
      expect(getRecentChatHistoryMock.mock.calls[0][0]).not.toHaveProperty("conversationId")
      // Each turn carries its OWN league, so a cross-league thread is not read as one league's.
      expect(body.turns.map((t: { text: string; leagueId: string | null }) => [t.text, t.leagueId])).toEqual([
        ["how is my team doing?", "cream-bowl"],
        ["Here is the read.", "kbfl"],
      ])
    })

    it("asks for the same thread whatever league the client sends, or none at all", async () => {
      const { GET } = await import("@/app/api/chat/chimmy/route")
      await GET(createMockNextRequest("http://localhost/api/chat/chimmy") as any)
      await GET(createMockNextRequest("http://localhost/api/chat/chimmy?leagueId=global") as any)
      await GET(createMockNextRequest("http://localhost/api/chat/chimmy?leagueId=kbfl") as any)
      expect(
        getRecentChatHistoryMock.mock.calls.map((c: unknown[]) => (c[0] as { userId: string }).userId)
      ).toEqual(["user-1", "user-1", "user-1"])
    })

    /*
     * 🛑 THE GROUNDING BADGE HAS TO COME BACK WITH THE WORDS. An answer Chimmy gave while unable
     * to read the league renders a "could not read your league" badge; restore the prose without
     * it and an ungrounded answer is indistinguishable from a grounded one.
     */
    it("restores the grounding, cost and mode a turn was stored with", async () => {
      getRecentChatHistoryMock.mockResolvedValueOnce([
        {
          role: "assistant",
          content: "I could not read your league.",
          createdAt: new Date("2026-09-20T01:00:00Z"),
          meta: { display: { grounding: { status: "unavailable" }, cost: 10, mode: "fast" } },
        },
      ])
      const { GET } = await import("@/app/api/chat/chimmy/route")
      const res = await GET(createMockNextRequest("http://localhost/api/chat/chimmy") as any)
      const [turn] = (await res.json()).turns
      expect(turn.grounding).toEqual({ status: "unavailable" })
      expect(turn.cost).toBe(10)
      expect(turn.mode).toBe("fast")
    })

    /*
     * ⚠ `advice` carries a live vote and `scenario` a board that has since moved — replaying
     * either puts a stale interactive control in front of someone and invites them to act on it.
     */
    it("does not replay stale interactive state, whatever the row carries", async () => {
      getRecentChatHistoryMock.mockResolvedValueOnce([
        {
          role: "assistant",
          content: "Add him.",
          createdAt: new Date(),
          meta: { display: { advice: { key: "a1" }, scenario: { before: 1 }, players: [{ name: "X" }], cost: "free" } },
        },
      ])
      const { GET } = await import("@/app/api/chat/chimmy/route")
      const [turn] = (await (await GET(createMockNextRequest("http://localhost/api/chat/chimmy") as any)).json()).turns
      expect(turn.advice).toBeUndefined()
      expect(turn.scenario).toBeUndefined()
      expect(turn.players).toBeUndefined()
      expect(turn.cost).toBeUndefined() // a non-numeric cost is dropped, not coerced
    })

    it("survives a malformed meta blob and a failed read", async () => {
      getRecentChatHistoryMock.mockResolvedValueOnce([
        { role: "assistant", content: "a", createdAt: new Date(), meta: "not an object" },
        { role: "assistant", content: "b", createdAt: new Date(), meta: { display: [] } },
      ])
      const { GET } = await import("@/app/api/chat/chimmy/route")
      const ok = await GET(createMockNextRequest("http://localhost/api/chat/chimmy") as any)
      expect((await ok.json()).turns).toHaveLength(2)

      getRecentChatHistoryMock.mockRejectedValueOnce(new Error("db down"))
      const degraded = await GET(createMockNextRequest("http://localhost/api/chat/chimmy") as any)
      expect(degraded.status).toBe(200)
      expect((await degraded.json()).turns).toEqual([])
    })

    it("clamps the limit so one request cannot ask for the whole table", async () => {
      const { GET } = await import("@/app/api/chat/chimmy/route")
      await GET(createMockNextRequest("http://localhost/api/chat/chimmy?limit=100000") as any)
      await GET(createMockNextRequest("http://localhost/api/chat/chimmy?limit=-5") as any)
      await GET(createMockNextRequest("http://localhost/api/chat/chimmy?limit=abc") as any)
      expect(
        getRecentChatHistoryMock.mock.calls.map((c: unknown[]) => (c[0] as { limit: number }).limit)
      ).toEqual([80, 1, 80])
    })
  })

})
