/**
 * Phase 3.14 — Activity Stream live.ts integration tests.
 *
 * Like Notification Center (3.13), Activity Stream is a pure composition
 * layer over five other modules' already-audited live clients. These tests
 * prove: isLiveReady gating; that all five sources returning null composes
 * to an honest, successful empty stream (not a placeholder error); that
 * real source data is mapped to the correct event type using only real
 * fields (lastRunResult, report status, task status); that `initiator` is
 * 'system' for risks/recommendations/automations/reports and 'human' for
 * every task event; and that real source timestamps are reused honestly.
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

const liveWorkspaceClientMock = vi.hoisted(() => ({ getTasks: vi.fn() }))
vi.mock("@/lib/commissioner-ui/workspace/decision-os-client/live", () => ({ liveWorkspaceClient: liveWorkspaceClientMock }))

import { liveActivityClient } from "@/lib/commissioner-ui/activity/decision-os-client/live"

beforeEach(() => {
  vi.clearAllMocks()
  liveLeagueHealthClientMock.getRisks.mockResolvedValue({ data: null, error: null })
  liveRecommendationsClientMock.getQueue.mockResolvedValue({ data: null, error: null })
  liveAutomationClientMock.getCatalog.mockResolvedValue({ data: null, error: null })
  liveReportsClientMock.getHistory.mockResolvedValue({ data: null, error: null })
  liveWorkspaceClientMock.getTasks.mockResolvedValue({ data: null, error: null })
})

describe("Activity Stream live.ts — isLiveReady gating", () => {
  it("not-yet-integrated placeholder when isLiveReady is false, without composing any source", async () => {
    isLiveReadyMock.mockResolvedValue(false)
    const result = await liveActivityClient.getEvents()
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "activity", retryable: false })
    expect(liveLeagueHealthClientMock.getRisks).not.toHaveBeenCalled()
  })
})

describe("Activity Stream live.ts — composition, once live-ready", () => {
  beforeEach(() => {
    isLiveReadyMock.mockResolvedValue(true)
  })

  it("when every source returns null (today's real state), getEvents succeeds with an honest empty stream — never a placeholder error", async () => {
    const result = await liveActivityClient.getEvents()
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })

  it("maps every risk to risk_detected with initiator system", async () => {
    liveLeagueHealthClientMock.getRisks.mockResolvedValue({
      data: [{ id: "risk-1", description: "Low trade activity this month", severity: "elevated", category: "activity", ageInDays: 10, status: "ongoing" }],
      error: null,
    })
    const result = await liveActivityClient.getEvents()
    expect(result.data).toContainEqual(expect.objectContaining({ id: "activity-risk-1", type: "risk_detected", initiator: "system", severity: "warning" }))
  })

  it("maps every recommendation to the single real type recommendation_created, reusing its real createdAt", async () => {
    liveRecommendationsClientMock.getQueue.mockResolvedValue({
      data: [{ id: "rec-1", title: "2 managers at risk", rationale: "x", severity: "critical", confidence: "high", expectedImpact: "x", primaryActionLabel: "x", status: "new", category: "retention", sourceModuleId: "recommendations", createdAt: "2026-06-29T00:00:00.000Z" }],
      error: null,
    })
    const result = await liveActivityClient.getEvents()
    expect(result.data).toContainEqual(expect.objectContaining({ id: "activity-rec-1", type: "recommendation_created", initiator: "system", timestamp: "2026-06-29T00:00:00.000Z" }))
  })

  it("maps automations by their real lastRunResult only — failure, success, and skipped/never-run are handled distinctly", async () => {
    liveAutomationClientMock.getCatalog.mockResolvedValue({
      data: [
        { id: "auto-fail", name: "Lineup Reminder", description: "x", category: "compliance_reminders", status: "enabled", health: "elevated", schedule: { triggerType: "event", description: "x" }, lastRunAt: "2026-07-01T00:00:00.000Z", lastRunResult: "failure", totalRunsCount: 5, successRatePercent: 80, relatedLinks: [] },
        { id: "auto-success", name: "Waiver Auto-void", description: "x", category: "waiver_management", status: "enabled", health: "positive", schedule: { triggerType: "event", description: "x" }, lastRunAt: "2026-07-02T00:00:00.000Z", lastRunResult: "success", totalRunsCount: 3, successRatePercent: 100, relatedLinks: [] },
        { id: "auto-skipped", name: "Standings Recap", description: "x", category: "communications", status: "disabled", health: "standard", schedule: { triggerType: "manual", description: "x" }, lastRunResult: "skipped", totalRunsCount: 0, successRatePercent: 0, relatedLinks: [] },
      ],
      error: null,
    })
    const result = await liveActivityClient.getEvents()
    expect(result.data).toContainEqual(expect.objectContaining({ id: "activity-auto-fail-failed", type: "automation_failed", timestamp: "2026-07-01T00:00:00.000Z" }))
    expect(result.data).toContainEqual(expect.objectContaining({ id: "activity-auto-success-success", type: "automation_executed", severity: "success", timestamp: "2026-07-02T00:00:00.000Z" }))
    expect(result.data?.some((e) => e.id.includes("auto-skipped"))).toBe(false)
  })

  it("maps reports by real status — failed and ready generate events, queued/generating do not", async () => {
    liveReportsClientMock.getHistory.mockResolvedValue({
      data: [
        { id: "report-failed", templateId: "t1", templateName: "Engagement Report", status: "failed", format: "pdf", generatedAt: "2026-07-01T00:00:00.000Z", generatedByLabel: "x", summary: "x", sizeLabel: "—", shareStatus: "private", relatedLinks: [] },
        { id: "report-ready", templateId: "t2", templateName: "Weekly Digest", status: "ready", format: "pdf", generatedAt: "2026-07-02T00:00:00.000Z", generatedByLabel: "x", summary: "x", sizeLabel: "184 KB", shareStatus: "private", relatedLinks: [] },
        { id: "report-generating", templateId: "t3", templateName: "Transaction Summary", status: "generating", format: "csv", generatedAt: "2026-07-03T00:00:00.000Z", generatedByLabel: "x", summary: "x", sizeLabel: "—", shareStatus: "private", relatedLinks: [] },
      ],
      error: null,
    })
    const result = await liveActivityClient.getEvents()
    expect(result.data).toContainEqual(expect.objectContaining({ id: "activity-report-failed", type: "report_failed" }))
    expect(result.data).toContainEqual(expect.objectContaining({ id: "activity-report-ready", type: "report_generated", severity: "success" }))
    expect(result.data?.some((e) => e.id === "activity-report-generating")).toBe(false)
  })

  it("maps tasks by real status — completed and archived generate events with initiator human, reusing task.updatedAt; other statuses do not", async () => {
    liveWorkspaceClientMock.getTasks.mockResolvedValue({
      data: [
        { id: "task-done", title: "Confirm co-commissioner permissions", description: "x", status: "completed", priority: "standard", createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-15T00:00:00.000Z", automationCandidate: false, relatedLinks: [] },
        { id: "task-archived", title: "Document tiebreaker rules", description: "x", status: "archived", priority: "standard", createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-20T00:00:00.000Z", automationCandidate: false, relatedLinks: [] },
        { id: "task-open", title: "Share season digest", description: "x", status: "open", priority: "standard", createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z", automationCandidate: false, relatedLinks: [] },
      ],
      error: null,
    })
    const result = await liveActivityClient.getEvents()
    expect(result.data).toContainEqual(expect.objectContaining({ id: "activity-task-done", type: "task_completed", initiator: "human", timestamp: "2026-06-15T00:00:00.000Z" }))
    expect(result.data).toContainEqual(expect.objectContaining({ id: "activity-task-archived", type: "task_archived", initiator: "human", timestamp: "2026-06-20T00:00:00.000Z" }))
    expect(result.data?.some((e) => e.id === "activity-task-open")).toBe(false)
  })

  it("every result carries source='live' and a valid ISO timestamp", async () => {
    const result = await liveActivityClient.getEvents()
    expect(result.source).toBe("live")
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false)
  })
})
