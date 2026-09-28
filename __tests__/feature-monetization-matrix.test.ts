import { describe, expect, it } from "vitest"
import {
  getFeatureBuyTokensPathFromMatrix,
  getFeatureTokenCostFromMatrix,
  getPremiumMonetizationForFeature,
  listFeatureMonetizationMatrix,
} from "@/lib/monetization/feature-monetization-matrix"
import {
  buildFeatureUpgradePath,
  COMMISSIONER_FEATURES,
  getRequiredPlanForFeature,
  isSubscriptionFeatureId,
  PRO_FEATURES,
  WAR_ROOM_FEATURES,
} from "@/lib/subscription/feature-access"
import { getTokenSpendRuleMatrixEntry } from "@/lib/tokens/pricing-matrix"

describe("Feature monetization matrix", () => {
  it("covers every subscription feature id with a premium matrix entry", () => {
    const expectedFeatureIds = [
      "trade_analyzer",
      "ai_chat",
      "ai_waivers",
      "planning_tools",
      "player_ai_recommendations",
      "matchup_explanations",
      "player_comparison_explanations",
      "advanced_scoring",
      "advanced_playoff_setup",
      "ai_collusion_detection",
      "ai_tanking_detection",
      "storyline_creation",
      "league_rankings",
      "draft_rankings",
      "ai_team_managers",
      "commissioner_automation",
      "draft_strategy_build",
      "draft_prep",
      "future_planning",
      "multi_year_strategy",
      "draft_board_intelligence",
      "roster_construction_planning",
      "ai_planning_3_5_year",
      "guillotine_ai",
      "salary_cap_ai",
      "survivor_ai",
      "zombie_ai",
    ] as const

    for (const featureId of expectedFeatureIds) {
      expect(isSubscriptionFeatureId(featureId)).toBe(true)
      expect(getPremiumMonetizationForFeature(featureId)).toBeTruthy()
    }
  })

  it("keeps plan families mapped correctly from the matrix", () => {
    for (const featureId of PRO_FEATURES) {
      expect(getRequiredPlanForFeature(featureId)).toBe("pro")
      expect(buildFeatureUpgradePath(featureId)).toContain("/upgrade?plan=pro")
    }
    for (const featureId of COMMISSIONER_FEATURES) {
      expect(getRequiredPlanForFeature(featureId)).toBe("commissioner")
      expect(buildFeatureUpgradePath(featureId)).toContain("/commissioner-upgrade")
    }
    for (const featureId of WAR_ROOM_FEATURES) {
      expect(getRequiredPlanForFeature(featureId)).toBe("war_room")
      // AF Legacy is bought on /upgrade; /war-room is its product page and cannot take a payment.
      expect(buildFeatureUpgradePath(featureId)).toContain("/upgrade?plan=war_room")
    }
  })

  it("keeps token-linked matrix entries connected to pricing matrix", () => {
    const premium = listFeatureMonetizationMatrix().filter(
      (entry) => entry.accessType !== "free"
    )
    for (const entry of premium) {
      const tokenRuleCode = entry.tokenRuleCode
      if (!tokenRuleCode) {
        expect(getFeatureTokenCostFromMatrix(entry.key)).toBeNull()
        expect(getFeatureBuyTokensPathFromMatrix(entry.key)).toBeNull()
        continue
      }
      const pricingEntry = getTokenSpendRuleMatrixEntry(tokenRuleCode)
      expect(pricingEntry).toBeTruthy()
      expect(getFeatureTokenCostFromMatrix(entry.key)).toBe(pricingEntry?.tokenCost ?? null)
      expect(getFeatureBuyTokensPathFromMatrix(entry.key)).toContain("/tokens?ruleCode=")
    }
  })
})
