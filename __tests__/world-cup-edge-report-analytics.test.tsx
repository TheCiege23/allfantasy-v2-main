/**
 * World Cup Daily Edge Report — analytics, feedback, and admin-health tests
 *
 * ── A: Analytics dedup ────────────────────────────────────────────────────────
 *   A1  "viewed" fires exactly once even when component re-mounts
 *   A2  cache-hit analytics fires exactly once on cache-hit GET
 *   A3  paid auto-fetch fires coaching_loaded exactly once (no duplicate)
 *   A4  post-to-chat analytics fires exactly once per click
 *
 * ── B: Feedback ───────────────────────────────────────────────────────────────
 *   B1  "helpful" click POSTs to /api/ai/feedback with correct payload
 *   B2  "not helpful" click shows reason chips (no POST yet)
 *   B3  reason click POSTs to /api/ai/feedback and fires analytics with reason
 *   B4  feedback fires trackEdgeReportFeedbackClicked beacon
 *
 * ── C: Billing clarity labels ─────────────────────────────────────────────────
 *   C1  fromCache=true shows "cached" billing label
 *   C2  coveredByPlan=true shows "included" billing label
 *   C3  tokenCharged=true shows "1 token used" billing label
 *
 * ── D: Cost-health feature naming ────────────────────────────────────────────
 *   D1  worldCupEdgeReportAi uses feature string "world_cup_daily_edge_report"
 *   D2  feedback route allows "world_cup_daily_edge_report"
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  confirmTokenSpendMock,
  isTokenConfirmResponseMock,
  trackViewedMock,
  trackCacheHitMock,
  trackCoachingLoadedMock,
  trackPostToChatMock,
  trackFeedbackMock,
  sendBeaconMock,
} = vi.hoisted(() => ({
  confirmTokenSpendMock: vi.fn(),
  isTokenConfirmResponseMock: vi.fn(),
  trackViewedMock: vi.fn(),
  trackCacheHitMock: vi.fn(),
  trackCoachingLoadedMock: vi.fn(),
  trackPostToChatMock: vi.fn(),
  trackFeedbackMock: vi.fn(),
  sendBeaconMock: vi.fn(),
}))

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

vi.mock("@/components/i18n/LanguageProviderClient", () => ({
  useOptionalLanguage: () => ({ language: "en" }),
}))
vi.mock("@/lib/world-cup/worldCupI18n", () => ({
  makeWcT: () => (key: string) => key,
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("@/lib/world-cup/worldCupClientTokenConfirm", () => ({
  confirmWorldCupTokenSpend: confirmTokenSpendMock,
  isWorldCupTokenConfirmationResponse: isTokenConfirmResponseMock,
}))

vi.mock("@/lib/world-cup/worldCupEdgeReportAnalytics", () => ({
  trackEdgeReportViewed: trackViewedMock,
  trackEdgeReportUnlockClicked: vi.fn(),
  trackEdgeReportTokenConfirmed: vi.fn(),
  trackEdgeReportCacheHit: trackCacheHitMock,
  trackEdgeReportCoachingLoaded: trackCoachingLoadedMock,
  trackEdgeReportError: vi.fn(),
  trackEdgeReportPostToChatClicked: trackPostToChatMock,
  trackEdgeReportFeedbackClicked: trackFeedbackMock,
}))

vi.mock("@/lib/analytics/client", () => ({
  sendProductAnalyticsBeacon: sendBeaconMock,
}))

// ── Component import ──────────────────────────────────────────────────────────
import WorldCupDailyEdgeReportCard from "@/components/brackets/world-cup/WorldCupDailyEdgeReportCard"

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSection(label: string) {
  return {
    headline: `${label} headline`,
    subtext: `${label} subtext`,
    bullets: [`${label} bullet`],
    confidence: "high" as const,
  }
}

const BASE_REPORT = {
  generatedAt: "2026-06-09T00:00:00.000Z",
  challengeId: "pool-1",
  poolName: "Test Pool",
  userRank: 2,
  totalEntries: 10,
  hasLiveData: true,
  hasPendingPicks: true,
  noEntry: false,
  sections: {
    matchThatMatters: makeSection("matchThatMatters"),
    rootFor: makeSection("rootFor"),
    threats: makeSection("threats"),
    bestPath: makeSection("bestPath"),
    mistakeToAvoid: makeSection("mistakeToAvoid"),
  },
  grounding: {
    poolName: "Test Pool",
    userRank: 2,
    totalEntries: 10,
    userScore: 80,
    userMaxPossible: 120,
    userChampion: "Brazil",
    championStillAlive: true,
    threatCount: 1,
    pendingPickCount: 2,
    pendingPickPoints: 20,
    topThreatName: "Rival A",
    topThreatCanReach: 5,
    bestClimbSpots: 3,
    hasLiveMatches: true,
  },
}

const GET_NO_CACHE = {
  report: BASE_REPORT,
  coachingAvailable: true,
  coachingFromCache: false,
  billing: { deterministicSections: "free", coachingTokenCost: 1, coachingCached: false },
}

const GET_CACHED = {
  ...GET_NO_CACHE,
  coachingFromCache: true,
  billing: { ...GET_NO_CACHE.billing, coachingCached: true },
}

function makeCoachingResponse(billing: { tokenCharged: boolean; fromCache: boolean; coveredByPlan: boolean }) {
  return {
    report: BASE_REPORT,
    coaching: {
      coachingInsight: "Root for Brazil to climb 2 spots.",
      commissionerPost: "Big match tonight — check your picks!",
      generatedAt: "2026-06-09T00:00:00.000Z",
      fromCache: billing.fromCache,
    },
    billing,
  }
}

const COACHING_TOKEN_CHARGED = makeCoachingResponse({ tokenCharged: true, fromCache: false, coveredByPlan: false })
const COACHING_FROM_CACHE = makeCoachingResponse({ tokenCharged: false, fromCache: true, coveredByPlan: false })
const COACHING_PLAN = makeCoachingResponse({ tokenCharged: false, fromCache: false, coveredByPlan: true })

function okRes(body: unknown) {
  return Promise.resolve(Response.json(body))
}

function renderCard(overrides?: {
  challengeId?: string
  aiEntitled?: boolean
  isCommissioner?: boolean
  onPostToChat?: jest.Mock
}) {
  const props = {
    challengeId: "pool-1",
    aiEntitled: false,
    isCommissioner: false,
    onPostToChat: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  return render(<WorldCupDailyEdgeReportCard {...props} />)
}

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  fetchMock.mockReset()
  confirmTokenSpendMock.mockReset()
  isTokenConfirmResponseMock.mockReset()
  isTokenConfirmResponseMock.mockReturnValue(false)
  trackViewedMock.mockReset()
  trackCacheHitMock.mockReset()
  trackCoachingLoadedMock.mockReset()
  trackPostToChatMock.mockReset()
  trackFeedbackMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ── Suite A: Analytics dedup ──────────────────────────────────────────────────

describe("A — analytics dedup", () => {
  it("A1: trackEdgeReportViewed fires exactly once on mount", async () => {
    fetchMock.mockReturnValueOnce(okRes(GET_NO_CACHE))

    renderCard()
    await waitFor(() => screen.getByTestId("edge-report-sections"))

    expect(trackViewedMock).toHaveBeenCalledTimes(1)
    expect(trackViewedMock).toHaveBeenCalledWith(
      expect.objectContaining({ challengeId: "pool-1", coachingFromCache: false })
    )
  })

  it("A2: cache-hit analytics fires exactly once when GET returns coachingFromCache=true", async () => {
    fetchMock.mockReturnValueOnce(okRes(GET_CACHED))
    fetchMock.mockReturnValueOnce(okRes(COACHING_FROM_CACHE))

    renderCard()
    await waitFor(() => screen.getByTestId("edge-report-coaching-block"))

    expect(trackCacheHitMock).toHaveBeenCalledTimes(1)
    expect(trackCacheHitMock).toHaveBeenCalledWith({ challengeId: "pool-1" })
  })

  it("A3: paid auto-fetch fires coaching_loaded exactly once", async () => {
    fetchMock.mockReturnValueOnce(okRes(GET_NO_CACHE))
    fetchMock.mockReturnValueOnce(okRes(COACHING_PLAN))

    renderCard({ aiEntitled: true })
    await waitFor(() => screen.getByTestId("edge-report-coaching-block"))

    expect(trackCoachingLoadedMock).toHaveBeenCalledTimes(1)
    expect(trackCoachingLoadedMock).toHaveBeenCalledWith(
      expect.objectContaining({ challengeId: "pool-1", billingMode: "plan" })
    )
    // "viewed" also fires exactly once
    expect(trackViewedMock).toHaveBeenCalledTimes(1)
  })

  it("A4: post-to-chat analytics fires exactly once per button click", async () => {
    fetchMock.mockReturnValueOnce(okRes(GET_NO_CACHE))
    fetchMock.mockReturnValueOnce(okRes(COACHING_TOKEN_CHARGED))

    const onPostToChat = vi.fn().mockResolvedValue(undefined)
    renderCard({ isCommissioner: true, onPostToChat })
    await waitFor(() => screen.getByTestId("edge-report-unlock-btn"))

    await act(async () => { fireEvent.click(screen.getByTestId("edge-report-unlock-btn")) })
    await waitFor(() => screen.getByTestId("edge-report-post-to-chat-btn"))

    await act(async () => { fireEvent.click(screen.getByTestId("edge-report-post-to-chat-btn")) })

    expect(trackPostToChatMock).toHaveBeenCalledTimes(1)
    expect(trackPostToChatMock).toHaveBeenCalledWith({ challengeId: "pool-1" })
  })
})

// ── Suite B: Feedback ─────────────────────────────────────────────────────────

describe("B — feedback", () => {
  async function loadCoachingAndGetFeedbackRow(aiEntitled = false) {
    fetchMock.mockReturnValueOnce(okRes(GET_NO_CACHE))
    fetchMock.mockReturnValueOnce(okRes(COACHING_TOKEN_CHARGED))
    // Feedback POST response
    fetchMock.mockReturnValue(
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) } as Response)
    )

    renderCard({ aiEntitled })
    if (!aiEntitled) {
      await waitFor(() => screen.getByTestId("edge-report-unlock-btn"))
      await act(async () => { fireEvent.click(screen.getByTestId("edge-report-unlock-btn")) })
    }
    await waitFor(() => screen.getByTestId("edge-report-feedback-row"))
  }

  it("B1: 'helpful' click POSTs to /api/ai/feedback with correct payload", async () => {
    await loadCoachingAndGetFeedbackRow()

    await act(async () => {
      fireEvent.click(screen.getByTestId("edge-report-feedback-helpful"))
    })

    await waitFor(() => screen.getByTestId("edge-report-feedback-thanks"))

    const feedbackCall = fetchMock.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("/api/ai/feedback")
    )
    expect(feedbackCall).toBeTruthy()
    const body = JSON.parse(feedbackCall![1].body as string)
    expect(body).toMatchObject({
      feature: "world_cup_daily_edge_report",
      rating: "helpful",
      sport: "world_cup",
    })
  })

  it("B2: 'not helpful' click shows reason chips without POSTing", async () => {
    await loadCoachingAndGetFeedbackRow()

    await act(async () => {
      fireEvent.click(screen.getByTestId("edge-report-feedback-not-helpful"))
    })

    expect(screen.getByTestId("edge-report-feedback-reasons")).toBeTruthy()
    expect(screen.getByTestId("edge-report-feedback-reason-too_basic")).toBeTruthy()
    expect(screen.getByTestId("edge-report-feedback-reason-not_actionable")).toBeTruthy()
    expect(screen.getByTestId("edge-report-feedback-reason-wrong_data")).toBeTruthy()
    expect(screen.getByTestId("edge-report-feedback-reason-great_insight")).toBeTruthy()

    // No feedback POST fired yet (only GET + POST coaching)
    const feedbackCalls = fetchMock.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("/api/ai/feedback")
    )
    expect(feedbackCalls.length).toBe(0)
  })

  it("B3: reason chip click POSTs not_helpful + reason in body", async () => {
    await loadCoachingAndGetFeedbackRow()

    await act(async () => {
      fireEvent.click(screen.getByTestId("edge-report-feedback-not-helpful"))
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId("edge-report-feedback-reason-too_basic"))
    })

    await waitFor(() => screen.getByTestId("edge-report-feedback-thanks"))

    const feedbackCall = fetchMock.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("/api/ai/feedback")
    )
    expect(feedbackCall).toBeTruthy()
    const body = JSON.parse(feedbackCall![1].body as string)
    expect(body).toMatchObject({
      feature: "world_cup_daily_edge_report",
      rating: "not_helpful",
      sport: "world_cup",
      reason: "too_basic",  // reason is now persisted, not analytics-only
    })
  })

  it("B4: feedback fires trackEdgeReportFeedbackClicked beacon", async () => {
    await loadCoachingAndGetFeedbackRow()

    await act(async () => {
      fireEvent.click(screen.getByTestId("edge-report-feedback-helpful"))
    })

    await waitFor(() => screen.getByTestId("edge-report-feedback-thanks"))

    expect(trackFeedbackMock).toHaveBeenCalledWith(
      expect.objectContaining({ challengeId: "pool-1", rating: "helpful" })
    )
  })

  it("B5: 'helpful' click does not include reason in POST body", async () => {
    await loadCoachingAndGetFeedbackRow()

    await act(async () => {
      fireEvent.click(screen.getByTestId("edge-report-feedback-helpful"))
    })

    await waitFor(() => screen.getByTestId("edge-report-feedback-thanks"))

    const feedbackCall = fetchMock.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("/api/ai/feedback")
    )
    expect(feedbackCall).toBeTruthy()
    const body = JSON.parse(feedbackCall![1].body as string)
    // reason should be absent — helpful clicks have no chip selection
    expect(body).not.toHaveProperty("reason")
  })
})

// ── Suite C: Billing clarity labels ───────────────────────────────────────────

describe("C — billing clarity labels", () => {
  async function loadCoachingWith(billing: { tokenCharged: boolean; fromCache: boolean; coveredByPlan: boolean }) {
    fetchMock.mockReturnValueOnce(okRes(GET_NO_CACHE))
    fetchMock.mockReturnValueOnce(okRes(makeCoachingResponse(billing)))
    renderCard({ aiEntitled: billing.coveredByPlan })
    if (!billing.coveredByPlan) {
      await waitFor(() => screen.getByTestId("edge-report-unlock-btn"))
      await act(async () => { fireEvent.click(screen.getByTestId("edge-report-unlock-btn")) })
    }
    await waitFor(() => screen.getByTestId("edge-report-billing-label"))
  }

  it("C1: fromCache=true shows cached billing label", async () => {
    await loadCoachingWith({ tokenCharged: false, fromCache: true, coveredByPlan: false })
    expect(screen.getByTestId("edge-report-billing-label").textContent).toContain(
      "wc.edgeReport.billing.cached"
    )
  })

  it("C2: coveredByPlan=true shows included billing label", async () => {
    fetchMock.mockReturnValueOnce(okRes(GET_NO_CACHE))
    fetchMock.mockReturnValueOnce(okRes(COACHING_PLAN))
    renderCard({ aiEntitled: true })
    await waitFor(() => screen.getByTestId("edge-report-billing-label"))
    expect(screen.getByTestId("edge-report-billing-label").textContent).toContain(
      "wc.edgeReport.billing.included"
    )
  })

  it("C3: tokenCharged=true shows '1 token used' billing label", async () => {
    await loadCoachingWith({ tokenCharged: true, fromCache: false, coveredByPlan: false })
    expect(screen.getByTestId("edge-report-billing-label").textContent).toContain(
      "wc.edgeReport.billing.charged"
    )
  })
})

// ── Suite D: Cost-health feature naming ───────────────────────────────────────

describe("D — cost-health feature naming", () => {
  it("D1: worldCupEdgeReportAi.ts uses 'world_cup_daily_edge_report' as the feature string", async () => {
    // Verify by reading the source — no mock needed
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const src = readFileSync(
      join(process.cwd(), "lib/world-cup/worldCupEdgeReportAi.ts"),
      "utf8"
    )
    // Should NOT contain the old name
    expect(src).not.toContain(`feature: "edge_report_coaching"`)
    // Should contain the new canonical name in all logAiInteraction calls
    const matches = src.match(/feature: "world_cup_daily_edge_report"/g)
    expect(matches).toBeTruthy()
    // There are 4 logAiInteraction calls in that file
    expect(matches!.length).toBeGreaterThanOrEqual(4)
  })

  it("D2: /api/ai/feedback route allows 'world_cup_daily_edge_report' as a valid feature", () => {
    const { readFileSync } = require("node:fs")
    const { join } = require("node:path")
    const src = readFileSync(
      join(process.cwd(), "app/api/ai/feedback/route.ts"),
      "utf8"
    )
    expect(src).toContain(`"world_cup_daily_edge_report"`)
  })

  it("D3: WORLD_CUP_EDGE_REPORT event map contains COACHING_LOADED and FEEDBACK_CLICKED", async () => {
    const { WORLD_CUP_EDGE_REPORT } = await import("@/lib/analytics/eventNames")
    expect(WORLD_CUP_EDGE_REPORT.COACHING_LOADED).toBe("wc.edge_report.coaching_loaded")
    expect(WORLD_CUP_EDGE_REPORT.FEEDBACK_CLICKED).toBe("wc.edge_report.feedback_clicked")
  })

  it("D4 (regression): worldCupEdgeReportAi.ts calls getCachedAiResult with feature param, not key", () => {
    // Bug fix: was calling { key: cacheKey } which the function doesn't accept.
    // That caused cache lookup to always miss, charging tokens on every POST.
    const { readFileSync } = require("node:fs")
    const { join } = require("node:path")
    const src = readFileSync(
      join(process.cwd(), "lib/world-cup/worldCupEdgeReportAi.ts"),
      "utf8"
    )
    // Must NOT use the broken key-based interface
    expect(src).not.toMatch(/getCachedAiResult\(\{\s*key:/)
    expect(src).not.toMatch(/saveAiResult\(\{\s*key:/)
    // Must use the correct feature+scopeType+scopeId interface
    expect(src).toContain('feature: "world_cup_daily_edge_report"')
    expect(src).toContain('scopeType: "user_pool_day"')
    expect(src).toContain("scopeId: cacheKey")
  })

  it("D5 (regression): edge-report route calls getCachedAiResult with feature param, not key", () => {
    // Same cache bug existed in the route's GET handler (coaching-cached check).
    const { readFileSync } = require("node:fs")
    const { join } = require("node:path")
    const src = readFileSync(
      join(process.cwd(), "app/api/brackets/world-cup/[challengeId]/edge-report/route.ts"),
      "utf8"
    )
    expect(src).not.toMatch(/getCachedAiResult\(\{\s*key:/)
    expect(src).toContain('feature: "world_cup_daily_edge_report"')
    expect(src).toContain("scopeId: cacheKey")
  })

  it("D6 (regression): worldCupEdgeReportAi.ts calls routeTextCall with messages array, not prompt", () => {
    // Bug fix: was passing { sport, feature, userId, prompt } which aren't valid
    // routeTextCall params → LLM was never actually called (result always { ok: false }).
    const { readFileSync } = require("node:fs")
    const { join } = require("node:path")
    const src = readFileSync(
      join(process.cwd(), "lib/world-cup/worldCupEdgeReportAi.ts"),
      "utf8"
    )
    // Must NOT use the invalid param signature
    expect(src).not.toMatch(/routeTextCall\(\{\s*sport:/)
    expect(src).not.toMatch(/routeTextCall\(\{\s*prompt:/)
    // Must use the correct messages interface
    expect(src).toContain("messages,")
    expect(src).toContain("role: \"user\"")
  })
})
