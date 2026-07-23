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
    "Pro + Commissioner + AF Legacy in one tier, plus maximum token discounts and platform priority.",
}

/**
 * Bullets for pricing cards (short lines for narrow columns). Deliberately excludes token
 * counts: this array renders unconditionally, before MonetizationPurchaseSurface's catalog
 * fetch resolves, so it has no live number to show here. The real monthly/yearly token count
 * for each plan is already rendered from the live catalog (lib/monetization/catalog.ts, itself
 * derived from lib/tokens/subscription-policy.ts) directly on that plan's purchase card, a few
 * lines below this summary on the same page — do not re-add a hardcoded token count here, it
 * was a second, independently-drifting copy of that number (wrong by up to 10x for 3 of 4
 * tiers before this fix) with no mechanism keeping it in sync.
 */
export const PLAN_FAMILY_INCLUDES: Record<PlanFamilyKey, readonly string[]> = {
  af_pro: [
    "Advanced Chimmy, bracket grading, and matchup analysis",
    "Dark horse, upset finder, confidence, and pick comparison",
  ],
  af_commissioner: [
    "Custom scoring, lock settings, invites, exports, and analytics",
    "Commissioner summaries, recaps, and leaderboard explanations",
  ],
  af_war_room: [
    "Live tournament and draft-room intelligence",
    "Dynasty, keeper, and multi-season planning workflows",
  ],
  af_supreme: [
    "AF Pro + Commissioner + AF Legacy in one plan",
    "Best for commissioners and power users who live in the product",
  ],
}
