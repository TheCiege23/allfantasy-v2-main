import { describe, expect, it } from "vitest"
import { buildDecisionOSAdapter, isWellFormedResponse } from "@/lib/commissioner-ui/adapter"

import { stubDecisionOSClient } from "@/lib/commissioner-ui/decision-os-client/stub"
import { demoDecisionOSClient } from "@/lib/commissioner-ui/decision-os-client/demo"
import { liveDecisionOSClient } from "@/lib/commissioner-ui/decision-os-client/live"
import { stubLeagueHealthClient } from "@/lib/commissioner-ui/league-health/decision-os-client/stub"
import { demoLeagueHealthClient } from "@/lib/commissioner-ui/league-health/decision-os-client/demo"
import { liveLeagueHealthClient } from "@/lib/commissioner-ui/league-health/decision-os-client/live"
import { stubManagerIntelligenceClient } from "@/lib/commissioner-ui/managers/decision-os-client/stub"
import { demoManagerIntelligenceClient } from "@/lib/commissioner-ui/managers/decision-os-client/demo"
import { liveManagerIntelligenceClient } from "@/lib/commissioner-ui/managers/decision-os-client/live"
import { stubRecommendationsClient } from "@/lib/commissioner-ui/recommendations/decision-os-client/stub"
import { demoRecommendationsClient } from "@/lib/commissioner-ui/recommendations/decision-os-client/demo"
import { liveRecommendationsClient } from "@/lib/commissioner-ui/recommendations/decision-os-client/live"
import { stubWorkspaceClient } from "@/lib/commissioner-ui/workspace/decision-os-client/stub"
import { demoWorkspaceClient } from "@/lib/commissioner-ui/workspace/decision-os-client/demo"
import { liveWorkspaceClient } from "@/lib/commissioner-ui/workspace/decision-os-client/live"
import { stubAutomationClient } from "@/lib/commissioner-ui/automations/decision-os-client/stub"
import { demoAutomationClient } from "@/lib/commissioner-ui/automations/decision-os-client/demo"
import { liveAutomationClient } from "@/lib/commissioner-ui/automations/decision-os-client/live"
import { stubAnalyticsClient } from "@/lib/commissioner-ui/analytics/decision-os-client/stub"
import { demoAnalyticsClient } from "@/lib/commissioner-ui/analytics/decision-os-client/demo"
import { liveAnalyticsClient } from "@/lib/commissioner-ui/analytics/decision-os-client/live"
import { stubReportsClient } from "@/lib/commissioner-ui/reports/decision-os-client/stub"
import { demoReportsClient } from "@/lib/commissioner-ui/reports/decision-os-client/demo"
import { liveReportsClient } from "@/lib/commissioner-ui/reports/decision-os-client/live"
import { stubSearchClient } from "@/lib/commissioner-ui/search/decision-os-client/stub"
import { demoSearchClient } from "@/lib/commissioner-ui/search/decision-os-client/demo"
import { liveSearchClient } from "@/lib/commissioner-ui/search/decision-os-client/live"
import { stubNotificationsClient } from "@/lib/commissioner-ui/notifications/decision-os-client/stub"
import { demoNotificationsClient } from "@/lib/commissioner-ui/notifications/decision-os-client/demo"
import { liveNotificationsClient } from "@/lib/commissioner-ui/notifications/decision-os-client/live"
import { stubActivityClient } from "@/lib/commissioner-ui/activity/decision-os-client/stub"
import { demoActivityClient } from "@/lib/commissioner-ui/activity/decision-os-client/demo"
import { liveActivityClient } from "@/lib/commissioner-ui/activity/decision-os-client/live"
import { stubHelpClient } from "@/lib/commissioner-ui/help/decision-os-client/stub"
import { demoHelpClient } from "@/lib/commissioner-ui/help/decision-os-client/demo"
import { liveHelpClient } from "@/lib/commissioner-ui/help/decision-os-client/live"

/**
 * The "Stub == Demo == Live, from the UI's perspective" proof the Phase
 * 3.0 foundation asked for, made explicit and runtime-checked rather
 * than left to the type system alone. Complements — does not replace —
 * `commissioner-os-adapter.test.ts`'s existing "every response returned
 * through the adapter is well-formed, in every mode" test, which already
 * proves per-call envelope correctness; this file proves the structural
 * claim that test assumes: every namespace's three tiers expose the
 * *identical* method surface, so a UI component built against one tier
 * is guaranteed to work unmodified against the other two — the entire
 * reason `live.ts` can replace `demo.ts` later with zero page changes.
 */
const NAMESPACES: Array<{ name: string; stub: object; demo: object; live: object }> = [
  { name: "Mission Control", stub: stubDecisionOSClient, demo: demoDecisionOSClient, live: liveDecisionOSClient },
  { name: "League Health", stub: stubLeagueHealthClient, demo: demoLeagueHealthClient, live: liveLeagueHealthClient },
  { name: "Manager Intelligence", stub: stubManagerIntelligenceClient, demo: demoManagerIntelligenceClient, live: liveManagerIntelligenceClient },
  { name: "Recommendations", stub: stubRecommendationsClient, demo: demoRecommendationsClient, live: liveRecommendationsClient },
  { name: "Workspace", stub: stubWorkspaceClient, demo: demoWorkspaceClient, live: liveWorkspaceClient },
  { name: "Automations", stub: stubAutomationClient, demo: demoAutomationClient, live: liveAutomationClient },
  { name: "Analytics", stub: stubAnalyticsClient, demo: demoAnalyticsClient, live: liveAnalyticsClient },
  { name: "Reports", stub: stubReportsClient, demo: demoReportsClient, live: liveReportsClient },
  { name: "Search", stub: stubSearchClient, demo: demoSearchClient, live: liveSearchClient },
  { name: "Notifications", stub: stubNotificationsClient, demo: demoNotificationsClient, live: liveNotificationsClient },
  { name: "Activity Stream", stub: stubActivityClient, demo: demoActivityClient, live: liveActivityClient },
  { name: "Help & Knowledge Center", stub: stubHelpClient, demo: demoHelpClient, live: liveHelpClient },
]

describe("commissioner-os live integration foundation — Stub == Demo == Live", () => {
  it("covers all twelve completed modules", () => {
    expect(NAMESPACES).toHaveLength(12)
  })

  it.each(NAMESPACES)("$name: stub, demo, and live expose the identical method surface", ({ stub, demo, live }) => {
    const stubMethods = Object.keys(stub).sort()
    const demoMethods = Object.keys(demo).sort()
    const liveMethods = Object.keys(live).sort()

    expect(stubMethods.length).toBeGreaterThan(0)
    expect(demoMethods).toEqual(stubMethods)
    expect(liveMethods).toEqual(stubMethods)
  })

  it.each(NAMESPACES)("$name: every method is present on all three tiers as a function", ({ stub, demo, live }) => {
    for (const key of Object.keys(stub)) {
      expect(typeof (stub as Record<string, unknown>)[key]).toBe("function")
      expect(typeof (demo as Record<string, unknown>)[key]).toBe("function")
      expect(typeof (live as Record<string, unknown>)[key]).toBe("function")
    }
  })

  it("the adapter composes all twelve namespaces identically regardless of which mode it was built for", () => {
    const stubAdapter = buildDecisionOSAdapter("stub")
    const demoAdapter = buildDecisionOSAdapter("demo")
    const liveAdapter = buildDecisionOSAdapter("live")

    const namespaceKeys = Object.keys(stubAdapter).filter((k) => k !== "mode").sort()
    expect(Object.keys(demoAdapter).filter((k) => k !== "mode").sort()).toEqual(namespaceKeys)
    expect(Object.keys(liveAdapter).filter((k) => k !== "mode").sort()).toEqual(namespaceKeys)
    expect(namespaceKeys).toHaveLength(12)
  })

  it("swapping the adapter's mode alone — with no page or component change — is sufficient to move from demo data to an honest live placeholder", async () => {
    const demoAdapter = buildDecisionOSAdapter("demo")
    const liveAdapter = buildDecisionOSAdapter("live")

    const demoResponse = await demoAdapter.leagueHealth.getHealthDetail()
    const liveResponse = await liveAdapter.leagueHealth.getHealthDetail()

    expect(isWellFormedResponse(demoResponse)).toBe(true)
    expect(isWellFormedResponse(liveResponse)).toBe(true)
    expect(demoResponse.data).not.toBeNull()
    expect(demoResponse.error).toBeNull()
    expect(liveResponse.data).toBeNull()
    expect(liveResponse.error?.category).toBe("upstream_unavailable")
  })
})
