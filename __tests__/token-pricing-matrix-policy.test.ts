import { describe, expect, it } from "vitest"
import { TOKEN_SPEND_RULE_MATRIX } from "@/lib/tokens/pricing-matrix"
import { resolveTokenChargeDecisionForEntitlement } from "@/lib/tokens/subscription-policy"

describe("Token pricing matrix and subscription coexistence policy", () => {
  it("includes required prompt-254 rule coverage with whole-number token costs", () => {
    const requiredCodes = [
      "ai_player_comparison_quick_explanation",
      "ai_waiver_one_off_suggestion",
      "ai_matchup_explanation_single",
      "ai_start_sit_explanation_single",
      "ai_lineup_recommendation_explanation_single",
      "ai_trade_analyzer_full_review",
      "ai_draft_helper_session_recommendation",
      "ai_draft_pick_explanation",
      "ai_weekly_planning_session",
      "ai_league_rankings_explanation",
      "ai_draft_rankings_explanation",
      "ai_war_room_multi_step_planning",
      "ai_strategy_3_5_year_planning",
      "ai_storyline_creation",
      "commissioner_ai_collusion_detection_scan",
      "commissioner_ai_tanking_detection_scan",
      "commissioner_ai_team_manager_actions",
      "commissioner_ai_full_draft_recap",
      "commissioner_ai_full_league_recap",
      "commissioner_ai_large_analysis",
      "world_cup_commissioner_ai_pool_summary",
      "world_cup_commissioner_ai_weekly_recap",
      "world_cup_commissioner_ai_leaderboard_analysis",
      "world_cup_commissioner_ai_who_can_still_win",
      "world_cup_commissioner_ai_full_pool_intelligence_report",
    ]

    const codes = new Set(TOKEN_SPEND_RULE_MATRIX.map((rule) => rule.code))
    for (const code of requiredCodes) {
      expect(codes.has(code)).toBe(true)
    }

    for (const rule of TOKEN_SPEND_RULE_MATRIX) {
      expect(Number.isInteger(rule.tokenCost)).toBe(true)
      expect(rule.tokenCost).toBeGreaterThan(0)
    }
  })

  it("keeps non-subscribers on full token pricing", () => {
    const decision = resolveTokenChargeDecisionForEntitlement({
      entitlement: {
        plans: [],
        status: "none",
        currentPeriodEnd: null,
        gracePeriodEnd: null,
      },
      ruleCode: "ai_trade_analyzer_full_review",
      baseTokenCost: 50,
    })

    expect(decision.chargeMode).toBe("tokens_only")
    expect(decision.effectiveTokenCost).toBe(50)
    expect(decision.subscriptionEligible).toBe(false)
  })

  /*
   * Subscriptions stopped discounting tokens in e026876bf (2026-08-17, "tokens off subscriptions"):
   * every plan's discountedTokenSpendPct is 0, because a subscriber has the plan's features
   * unlocked outright. The decision still identifies the subscriber; it just takes nothing off.
   */
  it("charges a subscriber full token price (no subscription discount since the pricing overhaul)", () => {
    const decision = resolveTokenChargeDecisionForEntitlement({
      entitlement: {
        plans: ["supreme"],
        status: "active",
        currentPeriodEnd: null,
        gracePeriodEnd: null,
      },
      ruleCode: "commissioner_ai_large_analysis",
      baseTokenCost: 100,
    })

    expect(decision.chargeMode).toBe("subscriber_discounted_tokens")
    expect(decision.discountPct).toBe(0)
    expect(decision.effectiveTokenCost).toBe(100)
  })

  /*
   * 225531335 (2026-08-17) repriced the matrix onto five scope bands — 1 lookup, 10 subject,
   * 30 team, 75 league, 200 agentic — with an explicit per-action list. These pins follow it; a
   * future price change should move this test in the same commit, deliberately.
   */
  it("matches the banded token costs for core AI and World Cup commissioner actions", () => {
    const byCode = new Map(TOKEN_SPEND_RULE_MATRIX.map((rule) => [rule.code, rule]))

    expect(byCode.get("ai_chimmy_chat_message")?.tokenCost).toBe(10)
    expect(byCode.get("world_cup_ai_matchup_analysis")?.tokenCost).toBe(10)
    expect(byCode.get("world_cup_ai_bracket_explanation")?.tokenCost).toBe(30)
    expect(byCode.get("world_cup_ai_commissioner_report")?.tokenCost).toBe(75)
    expect(byCode.get("world_cup_commissioner_ai_pool_summary")?.tokenCost).toBe(30)
    expect(byCode.get("world_cup_commissioner_ai_weekly_recap")?.tokenCost).toBe(75)
    expect(byCode.get("world_cup_commissioner_ai_leaderboard_analysis")?.tokenCost).toBe(75)
    expect(byCode.get("world_cup_commissioner_ai_who_can_still_win")?.tokenCost).toBe(75)
    expect(byCode.get("world_cup_commissioner_ai_full_pool_intelligence_report")?.tokenCost).toBe(200)
    // Every cost sits on one of the five bands — the invariant the repricing established.
    for (const rule of TOKEN_SPEND_RULE_MATRIX) expect([1, 10, 30, 75, 200]).toContain(rule.tokenCost)
  })
})
