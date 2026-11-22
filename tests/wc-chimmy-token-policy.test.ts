/**
 * World Cup Chimmy — token spend policy tests
 *
 * Proves the "charge after validation, not before" contract at the service layer:
 *
 *   1.  Free deterministic prompt      → commitTokenSpend NOT called
 *   2.  Cache hit                       → commitTokenSpend NOT called
 *   3.  Provider missing (null context) → commitTokenSpend NOT called
 *   4.  Paid plan LLM                   → commitTokenSpend NOT called even if provided
 *   5.  Free LLM, no commitTokenSpend   → returns normally, tokenCharged=false (409 is route-level)
 *   6.  Free LLM, commitTokenSpend ✓    → callback called exactly once AFTER routeTextCall
 *   7.  Validator-blocked LLM           → commitTokenSpend NOT called
 *   8.  LLM unavailable (ok: false)     → commitTokenSpend NOT called
 *   9.  Spend failure after valid LLM   → throws ChimmyTokenSpendFailedError,
 *                                          audit log has tokenChargeStatus=spend_failed
 *  10.  Cache hit + commitTokenSpend ✓  → callback NOT called (cache wins before LLM)
 *  11.  displayHint values              → correct label for each billing path
 *  12.  No double audit log             → exactly one logAiInteraction call even on spend failure
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

// ── routeTextCall — hoisted so the vi.mock factory can reference it ─────────────
const { routeTextCallMock } = vi.hoisted(() => ({
  routeTextCallMock: vi.fn().mockResolvedValue({
    ok: true,
    text: "QUICK: Deep tactical analysis.\nWHY: Your champion pick is exposed.\nEDGE: Focus on R16.",
    provider: "openai",
    model: "gpt-4o-mini",
    tokensUsed: 310,
  }),
}))
vi.mock("@/lib/ai/providerRouter", () => ({
  routeTextCall: routeTextCallMock,
}))

// ── logAiInteraction — capture audit calls ────────────────────────────────────
const { logAiInteractionMock } = vi.hoisted(() => ({
  logAiInteractionMock: vi.fn(),
}))
vi.mock("@/lib/ai/auditLogger", () => ({
  logAiInteraction: logAiInteractionMock,
}))

// ── validateAIResponse — must return ValidationResult shape, not a string ─────
const { validateAIResponseMock } = vi.hoisted(() => ({
  // Default: pass — passes text through as sanitized
  validateAIResponseMock: vi.fn().mockImplementation((text: string) => ({
    valid: true,
    failures: [],
    blockedByRule: null,
    sanitized: text,
  })),
}))
vi.mock("@/lib/ai/responseValidator", () => ({
  validateAIResponse: validateAIResponseMock,
  buildFallbackResponse: vi.fn().mockReturnValue("I can only answer based on verified pool data."),
}))

// ── Side-effect mocks ─────────────────────────────────────────────────────────
vi.mock("@/lib/ai-memory/chat-history-store", () => ({
  appendChatHistory: vi.fn().mockResolvedValue(undefined),
  buildChimmyConversationId: vi.fn().mockReturnValue("conv-policy-1"),
}))
vi.mock("@/lib/ai/aiConfig", () => ({
  getAiCacheTtls: vi.fn().mockReturnValue({
    chimmy: 1200,
    explain_bracket: 21600,
    commissioner_brain: 1800,
  }),
}))
vi.mock("@/lib/ai/deterministic", () => ({
  DETERMINISTIC_SOURCE: "deterministic",
  tryDeterministicAnswer: vi.fn().mockResolvedValue(null),
}))

// ── Cache mock — configurable per test ───────────────────────────────────────
const { getCachedAiResultMock, saveAiResultMock } = vi.hoisted(() => ({
  getCachedAiResultMock: vi.fn().mockResolvedValue(null),
  saveAiResultMock: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/ai/ai-result-cache", () => ({
  getCachedAiResult: getCachedAiResultMock,
  saveAiResult: saveAiResultMock,
}))

beforeEach(() => {
  vi.clearAllMocks()
  // Defaults: cache miss, LLM available, validator passes
  getCachedAiResultMock.mockResolvedValue(null)
  routeTextCallMock.mockResolvedValue({
    ok: true,
    text: "QUICK: Deep tactical analysis.\nWHY: Your champion pick is exposed.\nEDGE: Focus on R16.",
    provider: "openai",
    model: "gpt-4o-mini",
    tokensUsed: 310,
  })
  validateAIResponseMock.mockImplementation((text: string) => ({
    valid: true,
    failures: [],
    blockedByRule: null,
    sanitized: text,
  }))
})

import {
  generateWorldCupChimmyPrivateReply,
  ChimmyTokenSpendFailedError,
} from "@/lib/world-cup/worldCupChimmyPrivateReply"

// ─── Context helper ───────────────────────────────────────────────────────────

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    challengeId: "wc-challenge-99",
    poolName: "Policy Test Pool",
    isLocked: true,
    lockReason: null,
    participantCount: 10,
    entryCount: 10,
    finalizedEntryCount: 9,
    inviteCount: 0,
    liveDataStatus: "pool_only",
    lastSyncedAt: null,
    locale: "en",
    fetchedAt: "2026-06-09T12:00:00Z",
    liveMatches: [],
    upcomingMatches: [],
    recentMatches: [],
    groupStandings: [],
    entry: {
      entryId: "e-policy",
      entryName: "Policy Test Entry",
      rank: 3,
      totalScore: 120,
      maxPossibleScore: 190,
      championPick: "Germany",
      isComplete: true,
      isLocked: true,
      correctPicks: 6,
      incorrectPicks: 2,
      groupPicks: [],
      knockoutPicks: [],
      thirdPlacePicks: [],
    },
    leaderboard: [
      { entryId: "e1", totalScore: 180, rank: 1, entryName: "Alpha" },
      { entryId: "e2", totalScore: 160, rank: 2, entryName: "Beta" },
      { entryId: "e-policy", totalScore: 120, rank: 3, entryName: "Me" },
    ],
    scoring: {
      roundOf32Points: 1,
      roundOf16Points: 2,
      quarterFinalPoints: 4,
      semiFinalPoints: 8,
      finalPoints: 12,
      championBonusPoints: 16,
    },
    commissionerSettings: null,
    ...overrides,
  }
}

// ─── Tests 1–4: commitTokenSpend not called on non-LLM or paid paths ──────────

describe("commitTokenSpend is never called for non-chargeable paths", () => {
  it("1. deterministic prompt → commitTokenSpend not called", async () => {
    const commitMock = vi.fn()

    // "Who is leading?" triggers the WC-specific deterministic layer
    await generateWorldCupChimmyPrivateReply({
      userId: "u-policy",
      challengeId: "wc-challenge-99",
      prompt: "Who is leading the pool?",
      context: makeContext(),
      entitlements: { plan: null },
      commitTokenSpend: commitMock,
    })

    expect(commitMock).not.toHaveBeenCalled()
    expect(routeTextCallMock).not.toHaveBeenCalled()
  })

  it("2. cache hit → commitTokenSpend not called", async () => {
    getCachedAiResultMock.mockResolvedValue({
      resultText: "QUICK: Cached coaching insight.\nWHY: From prior session.",
      provider: "openai",
      model: null,
    })
    const commitMock = vi.fn()

    await generateWorldCupChimmyPrivateReply({
      userId: "u-policy",
      challengeId: "wc-challenge-99",
      prompt: "Break down my bracket risks and strategy in depth",
      context: makeContext(),
      entitlements: { plan: null },
      commitTokenSpend: commitMock,
    })

    expect(commitMock).not.toHaveBeenCalled()
    expect(routeTextCallMock).not.toHaveBeenCalled()
  })

  it("3. null context (provider missing) → commitTokenSpend not called", async () => {
    const commitMock = vi.fn()

    await generateWorldCupChimmyPrivateReply({
      userId: "u-policy",
      challengeId: "wc-challenge-99",
      prompt: "Give me deep strategic bracket analysis",
      context: null,
      entitlements: { plan: null },
      commitTokenSpend: commitMock,
    })

    expect(commitMock).not.toHaveBeenCalled()
    expect(routeTextCallMock).not.toHaveBeenCalled()
  })

  it("4. paid plan LLM → commitTokenSpend not called even when provided", async () => {
    const commitMock = vi.fn()

    const result = await generateWorldCupChimmyPrivateReply({
      userId: "u-pro",
      challengeId: "wc-challenge-99",
      prompt: "Explain why my bracket is risky and what I can do about it",
      context: makeContext(),
      entitlements: { plan: "pro" },
      commitTokenSpend: commitMock,
    })

    // LLM was called (complex prompt) but spend is covered by plan
    expect(routeTextCallMock).toHaveBeenCalled()
    expect(commitMock).not.toHaveBeenCalled()
    expect(result.billingDecision.reason).toBe("premium_plan_included")
    expect(result.billingDecision.shouldChargeToken).toBe(false)
  })
})

// ─── Test 5: no commitTokenSpend provided → service returns normally ──────────

describe("Free LLM without commitTokenSpend — route gate owns the 409", () => {
  it("5. shouldChargeToken=true but no callback → completes, tokenCharged=false", async () => {
    // The route sends the 409 *before* calling the service when the user hasn't confirmed.
    // At the service layer this means: shouldChargeToken=true, commitTokenSpend=null.
    // The service must complete gracefully — it must NOT charge anything on its own.
    const result = await generateWorldCupChimmyPrivateReply({
      userId: "u-free",
      challengeId: "wc-challenge-99",
      prompt: "Break down my bracket risks and give me strategic coaching advice",
      context: makeContext(),
      entitlements: { plan: null },
      // No commitTokenSpend — simulates unconfirmed free user (route sent 409 preview)
    })

    expect(result.billingDecision.shouldChargeToken).toBe(true)
    expect(result.billingDecision.reason).toBe("llm_required")

    const audit = logAiInteractionMock.mock.calls[0][0]
    expect(audit.tokenCharged).toBe(false)
    expect(audit.tokenChargeStatus).toBe("not_applicable")
  })
})

// ─── Test 6: confirmed free user → commitTokenSpend called AFTER routeTextCall ─

describe("Free LLM with confirmed spend — callback called once, in order", () => {
  it("6. commitTokenSpend called exactly once, after routeTextCall resolves", async () => {
    const callOrder: string[] = []

    routeTextCallMock.mockImplementation(async () => {
      callOrder.push("llm")
      return {
        ok: true,
        text: "QUICK: Tactical coaching.\nWHY: Position analysis.\nEDGE: Watch for upsets.",
        provider: "openai",
        model: "gpt-4o-mini",
        tokensUsed: 280,
      }
    })

    const commitMock = vi.fn().mockImplementation(async () => {
      callOrder.push("commit")
    })

    const result = await generateWorldCupChimmyPrivateReply({
      userId: "u-free-confirmed",
      challengeId: "wc-challenge-99",
      prompt: "Give me in-depth strategic coaching on my bracket position and risks",
      context: makeContext(),
      entitlements: { plan: null },
      commitTokenSpend: commitMock,
    })

    // Token spend happened
    expect(commitMock).toHaveBeenCalledOnce()
    expect(result.billingDecision.shouldChargeToken).toBe(true)

    // Order: LLM first, then commit (charge after generation)
    expect(callOrder).toEqual(["llm", "commit"])

    // Audit log confirms charged
    const audit = logAiInteractionMock.mock.calls[0][0]
    expect(audit.tokenCharged).toBe(true)
    expect(audit.tokenChargeStatus).toBe("charged")
  })
})

// ─── Tests 7–8: blocked/unavailable paths ────────────────────────────────────

describe("commitTokenSpend not called when LLM fails validation or is unavailable", () => {
  it("7. validator-blocked LLM → commitTokenSpend not called", async () => {
    validateAIResponseMock.mockReturnValue({
      valid: false,
      failures: [{ rule: "plan_gate_violation", severity: "block", detail: "Plan gate triggered" }],
      blockedByRule: "plan_gate_violation",
      sanitized: "",
    })
    const commitMock = vi.fn()

    const result = await generateWorldCupChimmyPrivateReply({
      userId: "u-free",
      challengeId: "wc-challenge-99",
      prompt: "Analyze my bracket strategy comprehensively",
      context: makeContext(),
      entitlements: { plan: null },
      commitTokenSpend: commitMock,
    })

    expect(commitMock).not.toHaveBeenCalled()
    expect(result.billingDecision.shouldChargeToken).toBe(false)
    expect(result.billingDecision.reason).toBe("validator_blocked")
  })

  it("8. LLM unavailable (ok: false) → commitTokenSpend not called", async () => {
    routeTextCallMock.mockResolvedValue({
      ok: false,
      text: "",
      provider: "openai",
      model: "gpt-4o-mini",
    })
    const commitMock = vi.fn()

    const result = await generateWorldCupChimmyPrivateReply({
      userId: "u-free",
      challengeId: "wc-challenge-99",
      prompt: "Explain my bracket risks in great depth",
      context: makeContext(),
      entitlements: { plan: null },
      commitTokenSpend: commitMock,
    })

    expect(commitMock).not.toHaveBeenCalled()
    expect(result.billingDecision.shouldChargeToken).toBe(false)
    expect(result.billingDecision.reason).toBe("provider_missing")
  })
})

// ─── Test 9: spend failure ────────────────────────────────────────────────────

describe("Spend failure after valid LLM response", () => {
  it("9. commit throws → ChimmyTokenSpendFailedError thrown, audit logs spend_failed", async () => {
    const spendError = new Error("Insufficient balance")
    const commitMock = vi.fn().mockRejectedValue(spendError)

    await expect(
      generateWorldCupChimmyPrivateReply({
        userId: "u-free-bankrupt",
        challengeId: "wc-challenge-99",
        prompt: "Analyze my bracket strategy and tell me how to improve",
        context: makeContext(),
        entitlements: { plan: null },
        commitTokenSpend: commitMock,
      })
    ).rejects.toThrow(ChimmyTokenSpendFailedError)

    // Audit log was fired before the throw with spend_failed
    expect(logAiInteractionMock).toHaveBeenCalledOnce()
    const audit = logAiInteractionMock.mock.calls[0][0]
    expect(audit.tokenChargeStatus).toBe("spend_failed")
    expect(audit.tokenCharged).toBe(false)
    expect(audit.shouldChargeToken).toBe(true)
  })
})

// ─── Test 10: cache + commitTokenSpend → callback not called ─────────────────

describe("Cache hit takes priority over spend path", () => {
  it("10. cache hit with commitTokenSpend provided → callback not called, reason=cache_hit", async () => {
    getCachedAiResultMock.mockResolvedValue({
      resultText: "QUICK: Cached deep insight.\nWHY: Already computed.",
      provider: "openai",
      model: null,
    })
    const commitMock = vi.fn()

    const result = await generateWorldCupChimmyPrivateReply({
      userId: "u-free",
      challengeId: "wc-challenge-99",
      prompt: "Break down my bracket risks and strategy comprehensively",
      context: makeContext(),
      entitlements: { plan: null },
      commitTokenSpend: commitMock,
    })

    expect(commitMock).not.toHaveBeenCalled()
    expect(result.billingDecision.reason).toBe("cache_hit")
    expect(result.billingDecision.shouldChargeToken).toBe(false)
  })
})

// ─── Test 11: displayHint values ─────────────────────────────────────────────

describe("billingDecision.displayHint — correct label for each path", () => {
  it("11. displayHint matches billing path label", async () => {
    // Deterministic path
    const det = await generateWorldCupChimmyPrivateReply({
      userId: "u1",
      challengeId: "c1",
      prompt: "Who is leading the pool?",
      context: makeContext(),
      entitlements: { plan: null },
    })
    expect(det.billingDecision.displayHint).toBe("No token used · answered from pool data")

    // Cache path
    getCachedAiResultMock.mockResolvedValue({
      resultText: "QUICK: Cached.",
      provider: "openai",
      model: null,
    })
    const cached = await generateWorldCupChimmyPrivateReply({
      userId: "u2",
      challengeId: "c1",
      prompt: "Analyze my deep strategic bracket position",
      context: makeContext(),
      entitlements: { plan: null },
    })
    expect(cached.billingDecision.displayHint).toBe("No token used · cached insight")
    getCachedAiResultMock.mockResolvedValue(null)

    // Premium plan path
    const pro = await generateWorldCupChimmyPrivateReply({
      userId: "u3",
      challengeId: "c1",
      prompt: "Analyze my bracket competition and give me strategic coaching",
      context: makeContext(),
      entitlements: { plan: "pro" },
    })
    expect(pro.billingDecision.displayHint).toBe("Included in your plan · Chimmy answer")

    // LLM required (free user, no commit — completes without charging)
    const free = await generateWorldCupChimmyPrivateReply({
      userId: "u4",
      challengeId: "c1",
      prompt: "Give me in-depth strategic bracket coaching",
      context: makeContext(),
      entitlements: { plan: null },
    })
    expect(free.billingDecision.displayHint).toBe("1 token used · Chimmy coaching answer")
  })
})

// ─── Test 12: no double audit log on spend failure ───────────────────────────

describe("Exactly one audit log call on spend failure", () => {
  it("12. only one logAiInteraction call even when commit throws", async () => {
    const commitMock = vi.fn().mockRejectedValue(new Error("DB down"))

    await expect(
      generateWorldCupChimmyPrivateReply({
        userId: "u-fail",
        challengeId: "c1",
        prompt: "Give me comprehensive strategic advice on my bracket",
        context: makeContext(),
        entitlements: { plan: null },
        commitTokenSpend: commitMock,
      })
    ).rejects.toThrow(ChimmyTokenSpendFailedError)

    // Only the spend_failed audit log is emitted — the normal one at function bottom
    // is never reached because we throw before it.
    expect(logAiInteractionMock).toHaveBeenCalledOnce()
    expect(logAiInteractionMock.mock.calls[0][0].tokenChargeStatus).toBe("spend_failed")
  })
})
