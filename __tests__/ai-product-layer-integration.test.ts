import { describe, expect, it } from "vitest"
import {
  AIProductLayer,
  getAIDashboardWidgetsForSurface,
  getAIToolDiscoveryLinks,
  getPrimaryChimmyEntry,
  getSupportedSportsForAI,
  shouldEnforceDeterministicFirst,
} from "@/lib/ai-product-layer"

describe("ai product layer integration", () => {
  it("builds context-aware Chimmy hrefs for product handoffs", () => {
    const entry = getPrimaryChimmyEntry({
      source: "tool_hub",
      leagueId: "league-123",
      sport: "SOCCER",
    })

    expect(entry.href.startsWith("/messages?tab=ai")).toBe(true)
    expect(entry.href).toContain("source=tool_hub")
    expect(entry.href).toContain("leagueId=league-123")
    expect(entry.href).toContain("sport=SOCCER")
  })

  it("resolves dashboard widgets with stable product context", () => {
    const widgets = getAIDashboardWidgetsForSurface("dashboard", {
      source: "dashboard_widget",
      leagueId: "league-1",
      sport: "NBA",
    })

    expect(widgets.length).toBeGreaterThan(0)
    expect(widgets.some((w) => w.featureKey === "trade_analyzer")).toBe(true)
    expect(widgets.some((w) => w.featureKey === "chimmy")).toBe(true)
    expect(widgets.every((w) => typeof w.href === "string" && w.href.length > 0)).toBe(true)
    expect(widgets.some((w) => w.href.includes("leagueId=league-1"))).toBe(true)
  })

  it("exposes discovery links across tool, chat, story, media", () => {
    const links = getAIToolDiscoveryLinks({ source: "search" })

    const categories = new Set(links.map((link) => link.category))
    expect(categories.has("tool")).toBe(true)
    expect(categories.has("chat")).toBe(true)
    expect(categories.has("story")).toBe(true)
    expect(categories.has("media")).toBe(true)
    // The only 'governance' link was "Psychological Profiles", retired under
    // Milestone 32 — see ai-product-layer-no-psychology.test.ts.
  })

  it("routes feature keys to the expected product destination", () => {
    expect(
      AIProductLayer.resolveProductRoute("draft_helper", {
        leagueId: "league-99",
      })
    ).toBe("/league/league-99/draft")

    expect(
      AIProductLayer.resolveProductRoute("chimmy_chat", {
        source: "ai_hub",
      }).startsWith("/messages?tab=ai")
    ).toBe(true)
  })

  it("keeps all supported sports available to AI surfaces", () => {
    expect(getSupportedSportsForAI()).toEqual([
      "NFL",
      "NHL",
      "NBA",
      "MLB",
      "NCAAF",
      "NCAAB",
      "SOCCER",
    ])
  })

  it("marks deterministic-first features at product level", () => {
    expect(shouldEnforceDeterministicFirst("trade_analyzer")).toBe(true)
    expect(shouldEnforceDeterministicFirst("psychological_profiles")).toBe(true)
    expect(shouldEnforceDeterministicFirst("story_creator")).toBe(false)
  })
})
