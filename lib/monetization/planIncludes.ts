import { PAID_TIER_TOP_DISPLAY_NAME } from "@/lib/brand/display-names"

export type PlanFamilyKey =
  | "af_pro"
  | "af_commissioner"
  | "af_war_room"
  | "af_supreme"

/** One-line value prop for plan summary grids. */
export const PLAN_FAMILY_SHORT_TAGLINE: Record<PlanFamilyKey, string> = {
  af_pro:
    "Player-focused tools: Chimmy, trades, waivers, and matchup edges across every supported sport.",
  af_commissioner:
    "Commissioner toolkit: governance, automations, and league operations — dues & payouts stay on FanCred.",
  af_war_room:
    "Draft room plus dynasty & long-term planning for deep, year-round fantasy managers.",
  af_supreme:
    `Pro + Commissioner + ${PAID_TIER_TOP_DISPLAY_NAME} in one tier, plus maximum token discounts and platform priority.`,
}

/** Bullets for pricing cards (short lines for narrow columns). */
export const PLAN_FAMILY_INCLUDES: Record<PlanFamilyKey, readonly string[]> = {
  af_pro: [
    "Advanced Chimmy, bracket grading, and matchup analysis",
    "Dark horse, upset finder, confidence, and pick comparison",
    "250 monthly tokens or 3,000 yearly tokens included",
  ],
  af_commissioner: [
    "Custom scoring, lock settings, invites, exports, and analytics",
    "Commissioner summaries, recaps, and leaderboard explanations",
    "500 monthly tokens or 6,000 yearly tokens included",
  ],
  af_war_room: [
    "Live tournament and draft-room intelligence",
    "Dynasty, keeper, and multi-season planning workflows",
    "3,000 monthly tokens or 36,000 yearly tokens included",
  ],
  af_supreme: [
    `AF Pro + Commissioner + ${PAID_TIER_TOP_DISPLAY_NAME} in one plan`,
    "1,500 monthly tokens or 18,000 yearly tokens included",
    "Best for commissioners and power users who live in the product",
  ],
}
