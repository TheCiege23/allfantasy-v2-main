export type PlanFamilyKey =
  | "af_pro"
  | "af_commissioner"
  | "af_war_room"
  | "af_supreme"

/**
 * ⚠ THIS FILE WAS A THIRD COPY OF THE TOKEN NUMBERS, AND IT HELD THE SAME WRONG
 * ONES. The catalog said Legacy granted 3,000/mo against 300 actually credited;
 * this file said 3,000 too. Commissioner's 500-vs-100 overpromise was duplicated
 * here as well. Fixing the catalog and the policy left these untouched and still
 * on the page — which is the entire failure mode, one more time: a fact written
 * down in several places, and the copy customers read is never the load-bearing
 * one.
 *
 * ⚠ SO THERE ARE NO TOKEN NUMBERS HERE AT ALL NOW, AND THERE SHOULD NEVER BE
 * AGAIN. Subscriptions do not grant tokens — tokens are the pay-per-use path for
 * people who do not subscribe. If a token figure is ever needed on a plan card,
 * derive it from lib/tokens/subscription-policy.ts at render time rather than
 * transcribing it into a fourth file.
 */

/** One-line value prop for plan summary grids. */
export const PLAN_FAMILY_SHORT_TAGLINE: Record<PlanFamilyKey, string> = {
  af_pro:
    "Player-focused tools: Chimmy, trades, waivers, and matchup edges across every supported sport.",
  af_commissioner:
    "Commissioner toolkit: governance, automations, and league operations — dues & payouts stay on FanCred.",
  af_war_room:
    "Draft room plus dynasty & long-term planning for deep, year-round fantasy managers.",
  /*
   * ⚠ NO LONGER "Pro + Commissioner + AF Legacy". SUPREME_INCLUDED_PLAN_IDS is
   * now [pro, commissioner]; Legacy stands on its own at $9.99 beside them. And
   * "maximum token discounts" described a subscriber discount that no longer
   * exists — it was dropped with the token grants.
   */
  af_supreme:
    "AF Pro and AF Commissioner in one tier, at less than buying both.",
}

/** Bullets for pricing cards (short lines for narrow columns). */
export const PLAN_FAMILY_INCLUDES: Record<PlanFamilyKey, readonly string[]> = {
  af_pro: [
    "Advanced Chimmy, bracket grading, and matchup analysis",
    "Dark horse, upset finder, confidence, and pick comparison",
    "Game-day lineup calls scored by your league's own settings",
  ],
  af_commissioner: [
    "Custom scoring, lock settings, invites, exports, and analytics",
    "Commissioner summaries, recaps, and leaderboard explanations",
    "League health, integrity checks, and the Commissioner OS",
  ],
  af_war_room: [
    "Live tournament and draft-room intelligence",
    "Dynasty, keeper, and multi-season planning workflows",
    "Priority access to new draft tooling",
  ],
  af_supreme: [
    "Everything in AF Pro and AF Commissioner",
    "Cheaper than the two subscriptions bought separately",
    "Best for commissioners who also manage their own teams",
  ],
}
