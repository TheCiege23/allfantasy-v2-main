import { CHIMMY_PLAN_DAILY_INCLUDED } from "@/lib/chimmy/planAllowanceView"

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
  // ⚠ Not "league operations" and not "Draft room": running a league and its draft room are
  // FREE (the Oct 15 paywall rule). These plans sell what sits on top of that.
  af_commissioner:
    "Commissioner automation, integrity and insight — running your league stays free, and dues & payouts stay on FanCred.",
  af_war_room:
    "Draft-room intelligence plus dynasty & long-term planning for deep, year-round fantasy managers.",
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
  /*
   * ⚠ WHAT AF PRO UNLOCKS FROM OCT 15, NOT BRACKET TOOLS. These bullets used to sell bracket
   * grading, dark horses and upset finders — a tournament product — on the card for the plan whose
   * paywall is the /core depth. They now name the gates themselves: player_depth, trade_depth and
   * competitive_edge (lib/core-app/coreDepthAccess.ts), start/sit (`start_sit` → af_pro in
   * lib/monetization/entitlements.ts), and the Chimmy allowance, read from the one constant the
   * counter enforces so the card cannot promise a different number.
   */
  af_pro: [
    `${CHIMMY_PLAN_DAILY_INCLUDED} Chimmy answers a day`,
    "Player deep dives: trade, compare and verdict views, market and history",
    "The full trade breakdown: the why, value layers, counters and partners",
    "Competitive Edge: what the manager across the table has actually done",
    "Start/sit calls and trade analysis",
  ],
  af_commissioner: [
    // ⚠ Lock settings and invites were listed here and are FREE — every commissioner
    // runs their league without a plan. Custom scoring TABLES are the paid part
    // (`advanced_scoring`); switching presets is free.
    "Custom scoring tables and league automation",
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
