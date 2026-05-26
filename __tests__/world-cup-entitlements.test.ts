import { describe, expect, it } from "vitest"
import {
  canCreateMultipleWorldCupEntries,
  canExportWorldCupLeaderboard,
  canUseWorldCupAiTools,
  canUseWorldCupChat,
  canUseWorldCupCommissionerTools,
  resolveWorldCupEntitlementSummary,
} from "@/lib/world-cup/worldCupEntitlements"

describe("World Cup entitlement helpers", () => {
  it("keeps normal free users out of premium World Cup tools (except basic chat)", () => {
    const input = { isOwner: false, isAdmin: false, hasBracketBrainAi: false }

    expect(canUseWorldCupCommissionerTools(input)).toBe(false)
    expect(canCreateMultipleWorldCupEntries(input)).toBe(false)
    expect(canExportWorldCupLeaderboard(input)).toBe(false)
    // Basic chat is open to all participants — API enforces pool membership
    expect(canUseWorldCupChat(input)).toBe(true)
    expect(canUseWorldCupAiTools(input)).toBe(false)
  })

  it("unlocks commissioner tools for owners, admins, and commissioner plans", () => {
    expect(canUseWorldCupCommissionerTools({ isOwner: true })).toBe(true)
    expect(canUseWorldCupCommissionerTools({ isAdmin: true })).toBe(true)
    expect(canUseWorldCupCommissionerTools({ plans: ["commissioner"] })).toBe(true)
    expect(canUseWorldCupCommissionerTools({ plans: ["supreme"] })).toBe(true)
  })

  it("unlocks AI tools for Bracket Brain access and Pro-style plans", () => {
    expect(canUseWorldCupAiTools({ hasBracketBrainAi: true })).toBe(true)
    expect(canUseWorldCupAiTools({ hasAfPro: true })).toBe(true)
    expect(canUseWorldCupAiTools({ plans: ["pro"] })).toBe(true)
    expect(canUseWorldCupAiTools({ plans: ["all_access"] })).toBe(true)
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

  describe("canUseWorldCupChat — open to all participants", () => {
    it("returns true for a free user with no flags set", () => {
      expect(canUseWorldCupChat({})).toBe(true)
    })

    it("returns true for an owner", () => {
      expect(canUseWorldCupChat({ isOwner: true })).toBe(true)
    })

    it("returns true for an admin", () => {
      expect(canUseWorldCupChat({ isAdmin: true })).toBe(true)
    })

    it("returns true even when all flags are explicitly false", () => {
      expect(canUseWorldCupChat({ isOwner: false, isAdmin: false, hasBracketBrainAi: false })).toBe(true)
    })

    it("does not change AI gating — AI tools still require subscription or pro access", () => {
      expect(canUseWorldCupAiTools({})).toBe(false)
      expect(canUseWorldCupAiTools({ isOwner: false, isAdmin: false })).toBe(false)
    })
  })

  describe("canUseWorldCupAiTools — admin gets full access via isAdmin flag", () => {
    it("grants AI access when isAdmin is true", () => {
      expect(canUseWorldCupAiTools({ isAdmin: true })).toBe(true)
    })

    it("grants AI access when allFantasyTestAccess is true", () => {
      expect(canUseWorldCupAiTools({ allFantasyTestAccess: true })).toBe(true)
    })

    it("denies AI access for pool owner without subscription", () => {
      expect(canUseWorldCupAiTools({ isOwner: true })).toBe(false)
    })
  })
})
