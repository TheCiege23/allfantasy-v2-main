/**
 * Phase 3.13 — Notification Center live.ts integration tests.
 *
 * Like Search (3.12), Notification Center is a pure composition layer over
 * other modules' already-audited live clients. These tests prove:
 * isLiveReady gating; that all four sources returning null composes to an
 * honest, successful empty inbox (not a placeholder error); that real
 * source data is filtered and projected correctly (only failed reports,
 * only automations needing attention, every risk, every recommendation);
 * that `read` always defaults to false (no fabricated read/unread mix);
 * and that real source timestamps are reused honestly, never invented.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const isLiveReadyMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/commissioner-ui/liveReadiness", () => ({ isLiveReady: isLiveReadyMock }))

const liveLeagueHealthClientMock = vi.hoisted(() => ({ getRisks: vi.fn() }))
vi.mock("@/lib/commissioner-ui/league-health/decision-os-client/live", () => ({ liveLeagueHealthClient: liveLeagueHealthClientMock }))

const liveRecommendationsClientMock = vi.hoisted(() => ({ getQueue: vi.fn() }))
vi.mock("@/lib/commissioner-ui/recommendations/decision-os-client/live", () => ({ liveRecommendationsClient: liveRecommendationsClientMock }))

const liveAutomationClientMock = vi.hoisted(() => ({ getCatalog: vi.fn() }))
vi.mock("@/lib/commissioner-ui/automations/decision-os-client/live", () => ({ liveAutomationClient: liveAutomationClientMock }))

const liveReportsClientMock = vi.hoisted(() => ({ getHistory: vi.fn() }))
vi.mock("@/lib/commissioner-ui/reports/decision-os-client/live", () => ({ liveReportsClient: liveReportsClientMock }))

import { liveNotificationsClient } from "@/lib/commissioner-ui/notifications/decision-os-client/live"

beforeEach(() => {
  vi.clearAllMocks()
  liveLeagueHealthClientMock.getRisks.mockResolvedValue({ data: null, error: null })
  liveRecommendationsClientMock.getQueue.mockResolvedValue({ data: null, error: null })
  liveAutomationClientMock.getCatalog.mockResolvedValue({ data: null, error: null })
  liveReportsClientMock.getHistory.mockResolvedValue({ data: null, error: null })
})

describe("Notification Center live.ts — isLiveReady gating", () => {
  it("getNotifications: not-yet-integrated placeholder when isLiveReady is false, without composing any source", async () => {
    isLiveReadyMock.mockResolvedValue(false)
    const result = await liveNotificationsClient.getNotifications()
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "notifications", retryable: false })
    expect(liveLeagueHealthClientMock.getRisks).not.toHaveBeenCalled()
  })

  it("getSummary: not-yet-integrated placeholder when isLiveReady is false", async () => {
    isLiveReadyMock.mockResolvedValue(false)
    const result = await liveNotificationsClient.getSummary()
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "notifications" })
  })
})

describe("Notification Center live.ts — composition, once live-ready", () => {
  beforeEach(() => {
    isLiveReadyMock.mockResolvedValue(true)
  })

  it("when every source returns null (today's real state), getNotifications succeeds with an honest empty inbox — never a placeholder error", async () => {
    const result = await liveNotificationsClient.getNotifications()
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })

  it("getSummary reflects an honest empty inbox the same way", async () => {
    const result = await liveNotificationsClient.getSummary()
    expect(result.error).toBeNull()
    expect(result.data).toEqual({ unreadCount: 0, criticalCount: 0, headline: "No unread notifications" })
  })

  it("projects every real risk, with read defaulted to false and severity correctly mapped", async () => {
    liveLeagueHealthClientMock.getRisks.mockResolvedValue({
      data: [{ id: "risk-1", description: "2 managers inactive for 3+ weeks", severity: "critical", category: "engagement", ageInDays: 21, status: "ongoing" }],
      error: null,
    })
    const result = await liveNotificationsClient.getNotifications()
    expect(result.data).toContainEqual(expect.objectContaining({
      id: "notification-risk-1",
      severity: "critical",
      message: "2 managers inactive for 3+ weeks",
      sourceModuleId: "league-health",
      read: false,
    }))
  })

  it("projects every real recommendation, reusing its real createdAt honestly (never inventing a new one)", async () => {
    liveRecommendationsClientMock.getQueue.mockResolvedValue({
      data: [{ id: "rec-1", title: "Trade deadline approaching", rationale: "x", severity: "elevated", confidence: "high", expectedImpact: "x", primaryActionLabel: "x", status: "new", category: "activity", sourceModuleId: "recommendations", createdAt: "2026-06-30T00:00:00.000Z" }],
      error: null,
    })
    const result = await liveNotificationsClient.getNotifications()
    expect(result.data).toContainEqual(expect.objectContaining({
      id: "notification-rec-1",
      severity: "warning",
      message: "Trade deadline approaching",
      createdAt: "2026-06-30T00:00:00.000Z",
      read: false,
    }))
  })

  it("only surfaces automations needing attention (degraded health or a failed last run) — a healthy, successful automation contributes no notification", async () => {
    liveAutomationClientMock.getCatalog.mockResolvedValue({
      data: [
        { id: "auto-healthy", name: "Healthy Automation", description: "x", category: "communications", status: "enabled", health: "positive", schedule: { triggerType: "manual", description: "x" }, lastRunResult: "success", totalRunsCount: 5, successRatePercent: 100, relatedLinks: [] },
        { id: "auto-failing", name: "Lineup lock reminder", description: "x", category: "compliance_reminders", status: "enabled", health: "elevated", schedule: { triggerType: "event", description: "x" }, lastRunAt: "2026-07-01T00:00:00.000Z", lastRunResult: "failure", totalRunsCount: 10, successRatePercent: 80, relatedLinks: [] },
      ],
      error: null,
    })
    const result = await liveNotificationsClient.getNotifications()
    expect(result.data?.some((n) => n.id === "notification-auto-healthy")).toBe(false)
    expect(result.data).toContainEqual(expect.objectContaining({
      id: "notification-auto-failing",
      severity: "warning",
      createdAt: "2026-07-01T00:00:00.000Z",
      read: false,
    }))
  })

  it("only surfaces failed reports — a ready report contributes no notification, and a failed report reuses its real generatedAt", async () => {
    liveReportsClientMock.getHistory.mockResolvedValue({
      data: [
        { id: "report-ready", templateId: "t1", templateName: "Weekly Digest", status: "ready", format: "pdf", generatedAt: "2026-07-01T00:00:00.000Z", generatedByLabel: "x", summary: "x", sizeLabel: "1 KB", shareStatus: "private", relatedLinks: [] },
        { id: "report-failed", templateId: "t2", templateName: "Engagement Report", status: "failed", format: "pdf", generatedAt: "2026-07-02T00:00:00.000Z", generatedByLabel: "x", summary: "x", sizeLabel: "—", shareStatus: "private", relatedLinks: [], failureReason: "Timed out" },
      ],
      error: null,
    })
    const result = await liveNotificationsClient.getNotifications()
    expect(result.data?.some((n) => n.id === "notification-report-ready")).toBe(false)
    expect(result.data).toContainEqual(expect.objectContaining({
      id: "notification-report-failed",
      severity: "warning",
      message: "Engagement Report failed to generate — Timed out",
      createdAt: "2026-07-02T00:00:00.000Z",
      read: false,
    }))
  })

  it("every result carries source='live' and a valid ISO timestamp", async () => {
    const result = await liveNotificationsClient.getNotifications()
    expect(result.source).toBe("live")
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false)
  })
})
