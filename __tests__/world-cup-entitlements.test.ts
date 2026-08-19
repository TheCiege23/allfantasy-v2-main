import { describe, expect, it } from "vitest"
import {
  canCreateMultipleWorldCupEntries,
  canExportWorldCupLeaderboard,
  canManageBasicWorldCupPool,
  canUseWorldCupAiTools,
  canUseWorldCupChat,
  canUseWorldCupCommissionerTools,
  resolveWorldCupEntitlementSummary,
} from "@/lib/world-cup/worldCupEntitlements"

describe("World Cup entitlement helpers", () => {
  it("keeps normal free users out of premium World Cup tools", () => {
    const input = { isOwner: false, isAdmin: false, hasBracketBrainAi: false }

    expect(canUseWorldCupCommissionerTools(input)).toBe(false)
    expect(canCreateMultipleWorldCupEntries(input)).toBe(true)
    expect(canExportWorldCupLeaderboard(input)).toBe(false)
    expect(canUseWorldCupChat(input)).toBe(true)
    expect(canUseWorldCupAiTools(input)).toBe(false)
  })

  it("splits basic owner controls from paid AF Commissioner tools", () => {
    expect(canManageBasicWorldCupPool({ isOwner: true })).toBe(true)
    expect(canUseWorldCupCommissionerTools({ isOwner: true })).toBe(false)
    expect(canUseWorldCupCommissionerTools({ isAdmin: true })).toBe(true)
    expect(canUseWorldCupCommissionerTools({ hasAfCommissioner: true })).toBe(true)
    expect(canUseWorldCupCommissionerTools({ plans: ["commissioner"] })).toBe(true)
    expect(canUseWorldCupCommissionerTools({ plans: ["supreme"] })).toBe(true)
  })

  it("unlocks AI tools for Bracket Brain access and Pro-style plans", () => {
    expect(canUseWorldCupAiTools({ hasBracketBrainAi: true })).toBe(true)
    expect(canUseWorldCupAiTools({ hasAfPro: true })).toBe(true)
    expect(canUseWorldCupAiTools({ plans: ["pro"] })).toBe(true)
    expect(canUseWorldCupAiTools({ plans: ["supreme"] })).toBe(true)
  })

  it("returns copy-ready labels for the shell premium panel", () => {
    expect(resolveWorldCupEntitlementSummary({}).labels).toEqual({
      commissioner: "Requires AF Commissioner",
      ai: "Requires AI/Pro",
    })

    expect(resolveWorldCupEntitlementSummary({ isAdmin: true }).labels).toEqual({
      commissioner: "AF Commissioner active",
      ai: "AI/Pro active",
    })
  })
})
