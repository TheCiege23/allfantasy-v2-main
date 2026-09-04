/**
 * Phase 3.12 — Search live.ts integration tests.
 *
 * Search is a pure composition layer over other modules' already-audited
 * live clients — no Decision OS transport call of its own. These tests
 * prove: isLiveReady gating; that pages/settings are always present (no
 * backend dependency); that each composed category degrades independently
 * (a null `.data` from one client contributes zero entries, without
 * failing the whole index); and that a real `.data` from a composed client
 * is projected into the index correctly, with nothing fabricated.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const isLiveReadyMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/commissioner-ui/liveReadiness", () => ({ isLiveReady: isLiveReadyMock }))

const liveRecommendationsClientMock = vi.hoisted(() => ({ getQueue: vi.fn() }))
vi.mock("@/lib/commissioner-ui/recommendations/decision-os-client/live", () => ({ liveRecommendationsClient: liveRecommendationsClientMock }))

const liveManagerIntelligenceClientMock = vi.hoisted(() => ({ getManagerDirectory: vi.fn() }))
vi.mock("@/lib/commissioner-ui/managers/decision-os-client/live", () => ({ liveManagerIntelligenceClient: liveManagerIntelligenceClientMock }))

const liveWorkspaceClientMock = vi.hoisted(() => ({ getTasks: vi.fn() }))
vi.mock("@/lib/commissioner-ui/workspace/decision-os-client/live", () => ({ liveWorkspaceClient: liveWorkspaceClientMock }))

const liveAutomationClientMock = vi.hoisted(() => ({ getCatalog: vi.fn() }))
vi.mock("@/lib/commissioner-ui/automations/decision-os-client/live", () => ({ liveAutomationClient: liveAutomationClientMock }))

const liveReportsClientMock = vi.hoisted(() => ({ getTemplates: vi.fn() }))
vi.mock("@/lib/commissioner-ui/reports/decision-os-client/live", () => ({ liveReportsClient: liveReportsClientMock }))

const liveHelpClientMock = vi.hoisted(() => ({ getArticles: vi.fn() }))
vi.mock("@/lib/commissioner-ui/help/decision-os-client/live", () => ({ liveHelpClient: liveHelpClientMock }))

import { liveSearchClient } from "@/lib/commissioner-ui/search/decision-os-client/live"
import { COMMISSIONER_ALL_NAV_ITEMS } from "@/lib/commissioner-ui/navigation/moduleNav"
import { SETTINGS_RESULTS } from "@/lib/commissioner-ui/search/decision-os-client/settingsResults"

const NULL_RESULT = { data: null, error: { category: "upstream_unavailable" as const, message: "not yet integrated", moduleId: "recommendations" as const, retryable: false, timestamp: new Date().toISOString() } }

beforeEach(() => {
  vi.clearAllMocks()
  liveRecommendationsClientMock.getQueue.mockResolvedValue(NULL_RESULT)
  liveManagerIntelligenceClientMock.getManagerDirectory.mockResolvedValue(NULL_RESULT)
  liveWorkspaceClientMock.getTasks.mockResolvedValue(NULL_RESULT)
  liveAutomationClientMock.getCatalog.mockResolvedValue(NULL_RESULT)
  liveReportsClientMock.getTemplates.mockResolvedValue(NULL_RESULT)
  liveHelpClientMock.getArticles.mockResolvedValue(NULL_RESULT)
})

describe("Search live.ts — isLiveReady gating", () => {
  it("not-yet-integrated placeholder when isLiveReady is false, without composing any category", async () => {
    isLiveReadyMock.mockResolvedValue(false)
    const result = await liveSearchClient.getIndex()
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "search", retryable: false })
    expect(liveRecommendationsClientMock.getQueue).not.toHaveBeenCalled()
    expect(liveHelpClientMock.getArticles).not.toHaveBeenCalled()
  })
})

describe("Search live.ts — composition, once live-ready", () => {
  beforeEach(() => {
    isLiveReadyMock.mockResolvedValue(true)
  })

  it("always includes real pages and settings entries, with zero backend dependency", async () => {
    const result = await liveSearchClient.getIndex()
    expect(result.error).toBeNull()
    const pageEntries = result.data?.filter((r) => r.category === "page") ?? []
    const settingEntries = result.data?.filter((r) => r.category === "setting") ?? []
    expect(pageEntries).toHaveLength(COMMISSIONER_ALL_NAV_ITEMS.length)
    expect(settingEntries).toEqual(SETTINGS_RESULTS)
  })

  it("when every composed client returns null data (today's real state), only pages + settings appear — the index still succeeds, never a placeholder error", async () => {
    const result = await liveSearchClient.getIndex()
    expect(result.error).toBeNull()
    expect(result.data?.some((r) => r.category === "recommendation")).toBe(false)
    expect(result.data?.some((r) => r.category === "manager")).toBe(false)
    expect(result.data?.some((r) => r.category === "task")).toBe(false)
    expect(result.data?.some((r) => r.category === "automation")).toBe(false)
    expect(result.data?.some((r) => r.category === "report")).toBe(false)
    expect(result.data?.some((r) => r.category === "help")).toBe(false)
  })

  it("projects real recommendation data into the index without fabricating any field", async () => {
    liveRecommendationsClientMock.getQueue.mockResolvedValue({
      data: [{ id: "rec-1", title: "Address 2 at-risk managers", sourceModuleId: "recommendations" }],
      error: null,
    })
    const result = await liveSearchClient.getIndex()
    expect(result.data).toContainEqual({
      id: "recommendation-rec-1",
      category: "recommendation",
      title: "Address 2 at-risk managers",
      href: "/commissioner-os/recommendations",
      sourceModuleId: "recommendations",
    })
  })

  it("projects real manager, task, automation, report, and help data independently of one another", async () => {
    liveManagerIntelligenceClientMock.getManagerDirectory.mockResolvedValue({ data: [{ id: "mgr-1", managerName: "Priya Natarajan" }], error: null })
    liveWorkspaceClientMock.getTasks.mockResolvedValue({ data: [{ id: "task-1", title: "Confirm co-commissioner permissions" }], error: null })
    liveAutomationClientMock.getCatalog.mockResolvedValue({ data: [{ id: "auto-1", name: "Trade-deadline reminder broadcast" }], error: null })
    liveReportsClientMock.getTemplates.mockResolvedValue({ data: [{ id: "tpl-1", name: "Weekly Commissioner Digest" }], error: null })
    liveHelpClientMock.getArticles.mockResolvedValue({ data: [{ id: "help-1", title: "How trade review works" }], error: null })

    const result = await liveSearchClient.getIndex()

    expect(result.data).toContainEqual({ id: "manager-mgr-1", category: "manager", title: "Priya Natarajan", href: "/commissioner-os/managers", sourceModuleId: "managers" })
    expect(result.data).toContainEqual({ id: "task-task-1", category: "task", title: "Confirm co-commissioner permissions", href: "/commissioner-os/workspace", sourceModuleId: "workspace" })
    expect(result.data).toContainEqual({ id: "automation-auto-1", category: "automation", title: "Trade-deadline reminder broadcast", href: "/commissioner-os/automations", sourceModuleId: "automations" })
    expect(result.data).toContainEqual({ id: "report-tpl-1", category: "report", title: "Weekly Commissioner Digest", href: "/commissioner-os/reports", sourceModuleId: "reports" })
    expect(result.data).toContainEqual({ id: "help-help-1", category: "help", title: "How trade review works", href: "/commissioner-os/help", sourceModuleId: "help" })
    // Recommendations still degrades independently — one real category doesn't force others to fabricate.
    expect(result.data?.some((r) => r.category === "recommendation")).toBe(false)
  })

  it("every result carries source='live' and a valid ISO timestamp", async () => {
    const result = await liveSearchClient.getIndex()
    expect(result.source).toBe("live")
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false)
  })
})
