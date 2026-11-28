import type { SubscriptionFeatureId, SubscriptionPlanId } from "@/lib/subscription/types"
import type { TokenSpendRuleCode } from "@/lib/tokens/constants"
import { getTokenSpendRuleMatrixEntry } from "@/lib/tokens/pricing-matrix"
import { upgradePathForPlan } from "@/lib/monetization/upgradeDestination"

type MonetizationAccessType = "free" | "subscription_only" | "subscription_or_tokens"

type MonetizationUnavailableBehavior = "show" | "disable_with_fallback" | "hide"

type MonetizationSurfaceHints = {
  routes: string[]
  components: string[]
}

type PremiumFeatureMonetizationEntry = {
  key: SubscriptionFeatureId
  title: string
  accessType: Exclude<MonetizationAccessType, "free">
  requiredPlanId: SubscriptionPlanId
  tokenRuleCode: TokenSpendRuleCode | null
  lockedReason: string
  backendEnforcement: string
  frontendGateBehavior: string
  unavailableBehavior: MonetizationUnavailableBehavior
  surfaceHints: MonetizationSurfaceHints
}

type FreeFeatureMonetizationEntry = {
  key: string
  title: string
  accessType: "free"
  requiredPlanId: null
  tokenRuleCode: null
  lockedReason: null
  backendEnforcement: string
  frontendGateBehavior: string
  unavailableBehavior: "show"
  surfaceHints: MonetizationSurfaceHints
}

type FeatureMonetizationEntry =
  | PremiumFeatureMonetizationEntry
  | FreeFeatureMonetizationEntry

function buildUpgradePathForPlanAndFeature(
  requiredPlanId: SubscriptionPlanId,
  featureId: SubscriptionFeatureId
): string {
  if (requiredPlanId === "pro") {
    return `/upgrade?plan=pro&feature=${encodeURIComponent(featureId)}`
  }
  if (requiredPlanId === "commissioner") {
    return `/commissioner-upgrade?feature=${encodeURIComponent(featureId)}`
  }
  // AF Legacy and Supreme are bought on /upgrade. `/war-room` is Legacy's product
  // page and cannot take a payment; `/pricing` does not sell Legacy at all.
  if (requiredPlanId === "war_room") {
    return upgradePathForPlan("af_war_room", { feature: featureId })
  }
  // Supreme is also the answer for any plan with no checkout of its own: it
  // unlocks every feature (feature-access `hasFeatureAccessForPlans`).
  return upgradePathForPlan("af_supreme", { feature: featureId })
}

export function buildMonetizationUpgradePathForFeature(featureId: SubscriptionFeatureId): string {
  const entry = PREMIUM_FEATURE_MONETIZATION_MATRIX_BY_KEY[featureId]
  if (!entry) return "/pricing"
  return buildUpgradePathForPlanAndFeature(entry.requiredPlanId, featureId)
}

function buildTokenPath(ruleCode: TokenSpendRuleCode | null): string | null {
  if (!ruleCode) return null
  return `/tokens?ruleCode=${encodeURIComponent(ruleCode)}`
}

const FREE_FEATURE_MONETIZATION_MATRIX: readonly FreeFeatureMonetizationEntry[] = [
  {
    key: "create_league",
    title: "Create league",
    accessType: "free",
    requiredPlanId: null,
    tokenRuleCode: null,
    lockedReason: null,
    backendEnforcement: "No premium entitlement required.",
    frontendGateBehavior: "Always visible.",
    unavailableBehavior: "show",
    surfaceHints: {
      routes: ["/create-league"],
      components: [],
    },
  },
  {
    key: "basic_league_settings",
    title: "Basic league settings",
    accessType: "free",
    requiredPlanId: null,
    tokenRuleCode: null,
    lockedReason: null,
    backendEnforcement: "Commissioner/member permission checks only.",
    frontendGateBehavior: "Always visible for authorized users.",
    unavailableBehavior: "show",
    surfaceHints: {
      routes: ["/app/league/[leagueId]?tab=Settings"],
      components: ["CommissionerControlsPanel"],
    },
  },
  {
    key: "basic_commissioner_actions",
    title: "Basic commissioner actions",
    accessType: "free",
    requiredPlanId: null,
    tokenRuleCode: null,
    lockedReason: null,
    backendEnforcement: "Commissioner permission checks only.",
    frontendGateBehavior: "Always visible for commissioners.",
    unavailableBehavior: "show",
    surfaceHints: {
      routes: ["/app/league/[leagueId]?tab=Commissioner"],
      components: ["CommissionerControlsPanel"],
    },
  },
  {
    key: "join_league",
    title: "Join league",
    accessType: "free",
    requiredPlanId: null,
    tokenRuleCode: null,
    lockedReason: null,
    backendEnforcement: "Invite/membership validation only.",
    frontendGateBehavior: "Always visible.",
    unavailableBehavior: "show",
    surfaceHints: {
      routes: ["/find-league"],
      components: [],
    },
  },
  {
    key: "run_free_or_paid_leagues",
    title: "Run free or paid leagues",
    accessType: "free",
    requiredPlanId: null,
    tokenRuleCode: null,
    lockedReason: null,
    backendEnforcement: "No premium entitlement required.",
    frontendGateBehavior: "Always visible with FanCred boundary notice.",
    unavailableBehavior: "show",
    surfaceHints: {
      routes: ["/app/league/[leagueId]", "/brackets/leagues/[leagueId]"],
      components: ["PaidLeagueNotice", "CommissionerFanCredSetupNotice"],
    },
  },
  {
    key: "live_draft_access",
    title: "Live draft access",
    accessType: "free",
    requiredPlanId: null,
    tokenRuleCode: null,
    lockedReason: null,
    backendEnforcement: "League membership checks only.",
    frontendGateBehavior: "Always visible for members.",
    unavailableBehavior: "show",
    surfaceHints: {
      routes: ["/league/[leagueId]/draft"],
      components: [],
    },
  },
  {
    key: "mock_draft_access",
    title: "Mock draft access",
    accessType: "free",
    requiredPlanId: null,
    tokenRuleCode: null,
    lockedReason: null,
    backendEnforcement: "No premium entitlement required.",
    frontendGateBehavior: "Always visible.",
    unavailableBehavior: "show",
    surfaceHints: {
      routes: ["/mock-draft", "/mock-draft-simulator"],
      components: [],
    },
  },
  {
    key: "basic_chat",
    title: "Basic chat",
    accessType: "free",
    requiredPlanId: null,
    tokenRuleCode: null,
    lockedReason: null,
    backendEnforcement: "Auth and membership checks only.",
    frontendGateBehavior: "Always visible for members.",
    unavailableBehavior: "show",
    surfaceHints: {
      routes: ["/messages", "/app/league/[leagueId]"],
      components: ["LeagueChatPanel"],
    },
  },
  {
    key: "league_discovery",
    title: "League discovery",
    accessType: "free",
    requiredPlanId: null,
    tokenRuleCode: null,
    lockedReason: null,
    backendEnforcement: "No premium entitlement required.",
    frontendGateBehavior: "Always visible.",
    unavailableBehavior: "show",
    surfaceHints: {
      routes: ["/find-league"],
      components: [],
    },
  },
  {
    key: "orphan_team_browsing",
    title: "Orphan team browsing",
    accessType: "free",
    requiredPlanId: null,
    tokenRuleCode: null,
    lockedReason: null,
    backendEnforcement: "No premium entitlement required.",
    frontendGateBehavior: "Always visible.",
    unavailableBehavior: "show",
    surfaceHints: {
      routes: ["/orphan-teams"],
      components: [],
    },
  },
  {
    key: "creator_league_browsing",
    title: "Creator league browsing",
    accessType: "free",
    requiredPlanId: null,
    tokenRuleCode: null,
    lockedReason: null,
    backendEnforcement: "No premium entitlement required.",
    frontendGateBehavior: "Always visible.",
    unavailableBehavior: "show",
    surfaceHints: {
      routes: ["/creator-leagues"],
      components: [],
    },
  },
  {
    key: "dashboard_basics",
    title: "Dashboard basics",
    accessType: "free",
    requiredPlanId: null,
    tokenRuleCode: null,
    lockedReason: null,
    backendEnforcement: "No premium entitlement required.",
    frontendGateBehavior: "Always visible.",
    unavailableBehavior: "show",
    surfaceHints: {
      routes: ["/dashboard"],
      components: ["FinalDashboardClient"],
    },
  },
  {
    key: "profile_settings_basics",
    title: "Profile and settings basics",
    accessType: "free",
    requiredPlanId: null,
    tokenRuleCode: null,
    lockedReason: null,
    backendEnforcement: "No premium entitlement required.",
    frontendGateBehavior: "Always visible.",
    unavailableBehavior: "show",
    surfaceHints: {
      routes: ["/profile"],
      components: [],
    },
  },
] as const

const PREMIUM_FEATURE_MONETIZATION_MATRIX: readonly PremiumFeatureMonetizationEntry[] = [
  {
    key: "trade_analyzer",
    title: "Trade Analyzer",
    accessType: "subscription_or_tokens",
    requiredPlanId: "pro",
    tokenRuleCode: "ai_trade_analyzer_full_review",
    lockedReason: "Trade Analyzer is part of AF Pro.",
    backendEnforcement: "requireFeatureEntitlement(trade_analyzer) with token fallback where endpoint supports hybrid.",
    frontendGateBehavior: "FeatureGate + InContextMonetizationCard + upgrade/token CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/trade-evaluator", "/trade-analyzer"],
      components: ["InContextMonetizationCard"],
    },
  },
  {
    key: "ai_chat",
    title: "Chimmy Chat",
    accessType: "subscription_or_tokens",
    requiredPlanId: "pro",
    tokenRuleCode: "ai_chimmy_chat_message",
    lockedReason: "Chimmy Chat is part of AF Pro.",
    backendEnforcement: "requireFeatureEntitlement(ai_chat) with token fallback where endpoint supports hybrid.",
    frontendGateBehavior: "FeatureGate + InContextMonetizationCard + upgrade/token CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/chimmy"],
      components: ["ChimmyChatShell"],
    },
  },
  {
    key: "ai_waivers",
    title: "Chimmy Waivers",
    accessType: "subscription_or_tokens",
    requiredPlanId: "pro",
    tokenRuleCode: "ai_waiver_engine_run",
    lockedReason: "Chimmy Waivers is part of AF Pro.",
    backendEnforcement: "requireFeatureEntitlement(ai_waivers) with token fallback where endpoint supports hybrid.",
    frontendGateBehavior: "InContextMonetizationCard + upgrade/token CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/waiver-wire", "/waiver-ai"],
      components: ["WaiverWirePage"],
    },
  },
  {
    key: "planning_tools",
    title: "Planning Tools",
    accessType: "subscription_or_tokens",
    requiredPlanId: "pro",
    tokenRuleCode: "ai_weekly_planning_session",
    lockedReason: "Planning tools are part of AF Pro.",
    backendEnforcement: "requireFeatureEntitlement(planning_tools) on POST /api/legacy/season-strategy; client FeatureGate around StrategyPlanner.",
    frontendGateBehavior: "FeatureGate + InContextMonetizationCard.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/af-legacy"],
      components: ["LegacyStrategyTab"],
    },
  },
  {
    key: "player_ai_recommendations",
    title: "Player Chimmy Analysis",
    accessType: "subscription_or_tokens",
    requiredPlanId: "pro",
    tokenRuleCode: "ai_lineup_recommendation_explanation_single",
    lockedReason: "Player-specific Chimmy analysis is part of AF Pro.",
    backendEnforcement: "requireFeatureEntitlement(player_ai_recommendations) on premium explanation actions.",
    frontendGateBehavior: "InContextMonetizationCard + upgrade/token CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/player-comparison-lab"],
      components: ["PlayerComparisonPage"],
    },
  },
  {
    key: "matchup_explanations",
    title: "Matchup Explanations",
    accessType: "subscription_or_tokens",
    requiredPlanId: "pro",
    tokenRuleCode: "ai_matchup_explanation_single",
    lockedReason: "Matchup explanations are part of AF Pro.",
    backendEnforcement: "requireFeatureEntitlement(matchup_explanations) with allowTokenFallback.",
    frontendGateBehavior: "InContextMonetizationCard + upgrade/token CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/simulation"],
      components: ["MatchupSimulationPage"],
    },
  },
  {
    key: "player_comparison_explanations",
    title: "Player Comparison Explanations",
    accessType: "subscription_or_tokens",
    requiredPlanId: "pro",
    tokenRuleCode: "ai_player_comparison_quick_explanation",
    lockedReason: "Player comparison Chimmy explanations are part of AF Pro.",
    backendEnforcement: "requireFeatureEntitlement(player_comparison_explanations) with token fallback where endpoint supports hybrid.",
    frontendGateBehavior: "FeatureGate + InContextMonetizationCard.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/player-comparison-lab"],
      components: ["AIExplanationPanel", "PlayerComparisonPage"],
    },
  },
  {
    key: "league_ai_coaching",
    title: "League Chimmy Coaching",
    accessType: "subscription_only",
    requiredPlanId: "pro",
    tokenRuleCode: null,
    lockedReason: "League Chimmy Coaching is part of AF Pro (monthly or yearly).",
    backendEnforcement: "requireFeatureEntitlement(league_ai_coaching) on POST /api/ai/coaching/plan; subscription-only (Stripe checkout: af_pro_monthly / af_pro_yearly).",
    frontendGateBehavior: "FeatureGate on league Chimmy Coaching tab.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/league/[leagueId]?view=ai_coaching"],
      components: ["AICoachingTab"],
    },
  },
  /*
   * 2026-11-26: the "My decisions" screen. requiredPlanId "pro" ONLY: the matrix accepts exactly one plan,
   * AF Supreme reaches it through SUPREME_INCLUDED_PLAN_IDS (supreme → pro, commissioner), and AF
   * Commissioner alone does not — which is the point; it is not `af_intelligence`.
   */
  {
    key: "decision_log_history",
    title: "Your decision history",
    accessType: "subscription_only",
    requiredPlanId: "pro",
    tokenRuleCode: null,
    lockedReason: "Your decision history — every logged call with its trade grade and how it turned out — is part of AF Pro.",
    backendEnforcement: "requireFeatureEntitlement(decision_log_history) on GET /api/legacy/decision-log (every view), plus the /core/decisions screen drawn as a CoreDepthLock from the server-side paywall read.",
    frontendGateBehavior: "CoreDepthLock (from=lock_decision_history) in place of the screen; the list is never fetched for a locked viewer.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/core/decisions"],
      components: ["DecisionLogScreen"],
    },
  },
  {
    key: "guillotine_ai",
    title: "Guilly Chimmy",
    accessType: "subscription_only",
    requiredPlanId: "pro",
    tokenRuleCode: null,
    lockedReason: "Guilly Chimmy is part of AF Pro.",
    backendEnforcement: "FeatureGate entitlement pattern for premium surface.",
    frontendGateBehavior: "FeatureGate with upgrade CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/app/league/[leagueId]"],
      components: ["GuillotineAIPanel"],
    },
  },
  {
    key: "salary_cap_ai",
    title: "Salary Cap Chimmy",
    accessType: "subscription_only",
    requiredPlanId: "pro",
    tokenRuleCode: null,
    lockedReason: "Salary Cap Chimmy is part of AF Pro.",
    backendEnforcement: "FeatureGate entitlement pattern for premium surface.",
    frontendGateBehavior: "FeatureGate with upgrade CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/app/league/[leagueId]"],
      components: ["SalaryCapAIPanel"],
    },
  },
  {
    key: "survivor_ai",
    title: "Survivor Chimmy (player)",
    accessType: "subscription_or_tokens",
    requiredPlanId: "pro",
    tokenRuleCode: "survivor_ai_vote_risk_quick",
    lockedReason: "Player-facing Survivor Chimmy (tribe, Tribal Council, Exile and best-ball help) runs on AF Tokens; the premium intel tiles are part of AF Pro.",
    backendEnforcement: "FeatureGate + token preflight for metered Survivor Chimmy actions.",
    frontendGateBehavior: "Locked badge, tooltip, upgrade + token CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/survivor/[leagueId]", "/app/league/[leagueId]"],
      components: ["SurvivorPremiumCommandCenterPanel", "SurvivorAIPanel"],
    },
  },
  {
    key: "survivor_host_ai",
    title: "Survivor host Chimmy",
    accessType: "subscription_or_tokens",
    requiredPlanId: "commissioner",
    tokenRuleCode: "survivor_ai_host_fairness_report",
    lockedReason: "Host and commissioner Survivor automation requires AF Commissioner (or AF Supreme). Heavy scans burn AF Tokens.",
    backendEnforcement: "requireFeatureEntitlement(survivor_host_ai) with token preflight on host routes.",
    frontendGateBehavior: "Host command-center tiles (mini-game planner, risk alerts, fairness radar) + upgrade CTA; tile locks enforced by GET survivor/premium.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/survivor/[leagueId]/commissioner"],
      components: ["SurvivorPremiumCommandCenterPanel", "SurvivorCommissionerDashboard"],
    },
  },
  {
    key: "big_brother_ai",
    title: "Big Brother Chimmy (player)",
    accessType: "subscription_or_tokens",
    requiredPlanId: "pro",
    tokenRuleCode: "big_brother_ai_vote_prediction",
    lockedReason:
      "Player-facing Big Brother Chimmy (vote reads, alliance scans, weekly recap) is part of AF Pro; deeper runs burn AF Tokens.",
    backendEnforcement: "FeatureGate + token preflight on POST /big-brother/ai.",
    frontendGateBehavior: "Locked badge + token CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/league/[leagueId]", "/big-brother/[leagueId]"],
      components: ["BigBrotherHome"],
    },
  },
  {
    key: "big_brother_host_ai",
    title: "Big Brother host Chimmy",
    accessType: "subscription_or_tokens",
    requiredPlanId: "commissioner",
    tokenRuleCode: "big_brother_ai_host_fairness",
    lockedReason:
      "Commissioner Chimmy automation (HOH/veto narration, fairness checks) requires AF Commissioner or Supreme.",
    backendEnforcement: "requireFeatureEntitlement(big_brother_host_ai) with token preflight.",
    frontendGateBehavior: "Command dashboard + upgrade CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/big-brother/[leagueId]/command"],
      components: ["BigBrotherCommandDashboard"],
    },
  },
  {
    key: "zombie_ai",
    title: "Zombie Chimmy",
    accessType: "subscription_only",
    requiredPlanId: "pro",
    tokenRuleCode: null,
    lockedReason: "Zombie Chimmy is part of AF Pro.",
    backendEnforcement: "FeatureGate entitlement pattern for premium surface.",
    frontendGateBehavior: "FeatureGate with upgrade CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/app/league/[leagueId]"],
      components: ["ZombieAIPanel", "ZombieUniverseAIPanel"],
    },
  },
  {
    key: "advanced_scoring",
    title: "Advanced Scoring",
    accessType: "subscription_only",
    requiredPlanId: "commissioner",
    tokenRuleCode: null,
    lockedReason: "Advanced scoring controls require AF Commissioner.",
    backendEnforcement: "requireFeatureEntitlement(advanced_scoring) on protected settings writes.",
    frontendGateBehavior: "Premium tab links + upgrade CTA.",
    unavailableBehavior: "show",
    surfaceHints: {
      routes: ["/app/league/[leagueId]?tab=Settings&settingsTab=Scoring%20Settings"],
      components: ["CommissionerControlsPanel", "CommissionerTab"],
    },
  },
  {
    key: "advanced_playoff_setup",
    title: "Advanced Playoff Setup",
    accessType: "subscription_only",
    requiredPlanId: "commissioner",
    tokenRuleCode: null,
    lockedReason: "Advanced playoff setup requires AF Commissioner.",
    backendEnforcement: "requireFeatureEntitlement(advanced_playoff_setup) on protected settings writes.",
    frontendGateBehavior: "Premium tab links + upgrade CTA.",
    unavailableBehavior: "show",
    surfaceHints: {
      routes: ["/app/league/[leagueId]?tab=Settings&settingsTab=Playoff%20Settings"],
      components: ["CommissionerControlsPanel", "CommissionerTab"],
    },
  },
  {
    key: "ai_collusion_detection",
    title: "Chimmy Collusion Detection",
    accessType: "subscription_or_tokens",
    requiredPlanId: "commissioner",
    tokenRuleCode: "commissioner_ai_collusion_detection_scan",
    lockedReason: "Collusion detection is part of AF Commissioner.",
    backendEnforcement: "NOT enforced under this key (audit 2026-11-10): integrity scans are gated by commissioner_integrity_monitoring (lib/integrity/leagueEntitlement.ts).",
    frontendGateBehavior: "InContextMonetizationCard + token preview + upgrade/token CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/app/league/[leagueId]?tab=Commissioner"],
      components: ["AICommissionerPanel"],
    },
  },
  {
    key: "ai_tanking_detection",
    title: "Chimmy Tanking Detection",
    accessType: "subscription_or_tokens",
    requiredPlanId: "commissioner",
    tokenRuleCode: "commissioner_ai_tanking_detection_scan",
    lockedReason: "Tanking detection is part of AF Commissioner.",
    backendEnforcement: "NOT enforced under this key (audit 2026-11-10): tanking flags are gated by commissioner_integrity_monitoring (lib/integrity/leagueEntitlement.ts).",
    frontendGateBehavior: "InContextMonetizationCard + token preview + upgrade/token CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/app/league/[leagueId]?tab=Commissioner"],
      components: ["AICommissionerPanel"],
    },
  },
  {
    key: "storyline_creation",
    title: "Storyline Creation",
    accessType: "subscription_only",
    requiredPlanId: "commissioner",
    tokenRuleCode: null,
    lockedReason: "Storyline creation is part of AF Commissioner.",
    backendEnforcement: "League commissioner's plan via lib/league-story-ai/leagueStoryAiGate.ts (storyline_creation), plus per-league daily caps; tokens do not unlock it.",
    frontendGateBehavior: "StoryAiLockNotice (LockedFeatureCard) + upgrade CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/app/league/[leagueId]"],
      components: ["OverviewTab", "LeagueDramaPanel"],
    },
  },
  {
    key: "league_rankings",
    title: "League Rankings",
    accessType: "subscription_or_tokens",
    requiredPlanId: "commissioner",
    tokenRuleCode: "ai_league_rankings_explanation",
    lockedReason: "League rankings intelligence is part of AF Commissioner.",
    backendEnforcement: "requireFeatureEntitlement(league_rankings) with allowTokenFallback.",
    frontendGateBehavior: "InContextMonetizationCard + upgrade/token CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/app/league/[leagueId]?tab=Power%20Rankings"],
      components: ["PowerRankingsPage"],
    },
  },
  {
    key: "draft_rankings",
    title: "Draft Rankings",
    accessType: "subscription_or_tokens",
    requiredPlanId: "commissioner",
    tokenRuleCode: "ai_draft_rankings_explanation",
    lockedReason: "Draft rankings intelligence is part of AF Commissioner.",
    backendEnforcement: "requireFeatureEntitlement(draft_rankings) on Chimmy explanations of GET /api/leagues/[leagueId]/draft-results (?aiExplain=1); the deterministic rankings stay free and aiExplainLocked carries the refusal.",
    frontendGateBehavior: "Premium link + in-context card where draft-ranking actions execute.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/league/[leagueId]/draft-results"],
      components: ["CommissionerTab"],
    },
  },
  {
    key: "ai_team_managers",
    title: "Chimmy Team Managers",
    accessType: "subscription_or_tokens",
    requiredPlanId: "commissioner",
    tokenRuleCode: "commissioner_ai_team_manager_actions",
    lockedReason: "Chimmy team manager controls are part of AF Commissioner.",
    backendEnforcement: "requireFeatureEntitlement(ai_team_managers) with token fallback on metered actions.",
    frontendGateBehavior: "Premium action button + upgrade/token CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/app/league/[leagueId]?tab=Settings"],
      components: ["CommissionerControlsPanel"],
    },
  },
  {
    key: "commissioner_automation",
    title: "Chimmy Commissioner",
    accessType: "subscription_or_tokens",
    requiredPlanId: "commissioner",
    tokenRuleCode: "commissioner_ai_cycle_run",
    lockedReason: "Chimmy Commissioner automation is part of AF Commissioner.",
    backendEnforcement: "requireFeatureEntitlement(commissioner_automation) with allowTokenFallback on run/chat actions.",
    frontendGateBehavior: "FeatureGate + InContextMonetizationCard + token modal preflight.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/app/league/[leagueId]?tab=Commissioner"],
      components: ["CommissionerTab", "AICommissionerPanel"],
    },
  },
  {
    key: "draft_strategy_build",
    title: "Draft Strategy Builder",
    accessType: "subscription_or_tokens",
    requiredPlanId: "war_room",
    tokenRuleCode: "ai_draft_helper_session_recommendation",
    lockedReason: "Draft strategy builder is part of AF Legacy.",
    backendEnforcement: "Client FeatureGate on the draft helper's War Room; server: requireFeatureEntitlement(draft_strategy_build) on Chimmy narrative of POST /api/war-room/recommend (deterministic picks stay open).",
    frontendGateBehavior: "FeatureGate + InContextMonetizationCard + upgrade/token CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/league/[leagueId]/draft"],
      components: ["DraftHelperPanel"],
    },
  },
  {
    key: "draft_prep",
    title: "Draft Planning",
    accessType: "subscription_or_tokens",
    requiredPlanId: "war_room",
    tokenRuleCode: "ai_draft_pick_explanation",
    lockedReason: "Draft planning is part of AF Legacy.",
    backendEnforcement: "None since 2026-11-28: the draft-room pick explanation (POST /api/draft/recommend) moved to the ENTITLEMENTS key draft_room_ai_explanation (AF Pro, AF Legacy, AF Supreme). This key remains the War Room's draft-planning card.",
    frontendGateBehavior: "WarRoomTab gated tool card.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/league/[leagueId]"],
      components: ["WarRoomTab"],
    },
  },
  {
    key: "future_planning",
    title: "Future-Year Planning",
    accessType: "subscription_or_tokens",
    requiredPlanId: "war_room",
    tokenRuleCode: "ai_strategy_3_5_year_planning",
    lockedReason: "Future-year planning is part of AF Legacy.",
    backendEnforcement: "Client FeatureGate only (WarRoomTab link card, LegacyStrategyTab). The roadmap it leads to is server-gated by ai_planning_3_5_year.",
    frontendGateBehavior: "FeatureGate + in-context card where planning runs.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/af-legacy"],
      components: ["LegacyStrategyTab"],
    },
  },
  {
    key: "multi_year_strategy",
    title: "Long-Range Strategy",
    accessType: "subscription_or_tokens",
    requiredPlanId: "war_room",
    tokenRuleCode: "ai_strategy_3_5_year_planning",
    lockedReason: "Long-range strategy is part of AF Legacy.",
    backendEnforcement: "Client FeatureGate only (WarRoomTab link card). The roadmap it leads to is server-gated by ai_planning_3_5_year.",
    frontendGateBehavior: "FeatureGate + in-context card where planning runs.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/war-room"],
      components: [],
    },
  },
  {
    key: "draft_board_intelligence",
    title: "AF Legacy Board Intelligence",
    accessType: "subscription_or_tokens",
    requiredPlanId: "war_room",
    tokenRuleCode: "ai_war_room_multi_step_planning",
    lockedReason: "AF Legacy board intelligence is part of AF Legacy.",
    backendEnforcement: "NOT enforced under this key (audit 2026-11-10): /api/draft-war-room gates on pro_draft_ai or war_room_draft_strategy.",
    frontendGateBehavior: "FeatureGate + in-context card where board intelligence runs.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/war-room"],
      components: [],
    },
  },
  {
    key: "roster_construction_planning",
    title: "Roster Construction Planning",
    accessType: "subscription_or_tokens",
    requiredPlanId: "war_room",
    tokenRuleCode: "ai_war_room_multi_step_planning",
    lockedReason: "Roster construction planning is part of AF Legacy.",
    backendEnforcement: "requireFeatureEntitlement(roster_construction_planning): GET best-ball-war-room omits construction (constructionLocked) and POST roster-construction refuses without the plan.",
    frontendGateBehavior: "FeatureGate + in-context card where planning runs.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/war-room"],
      components: [],
    },
  },
  {
    key: "ai_planning_3_5_year",
    title: "3-5 Year Chimmy Planning",
    accessType: "subscription_or_tokens",
    requiredPlanId: "war_room",
    tokenRuleCode: "ai_strategy_3_5_year_planning",
    lockedReason: "Long-horizon planning is part of AF Legacy.",
    backendEnforcement: "requireFeatureEntitlement(ai_planning_3_5_year) on POST /api/rankings/dynasty-roadmap and /api/franchise-roadmap (no token fallback).",
    frontendGateBehavior: "FeatureGate + in-context card where planning runs.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/war-room"],
      components: [],
    },
  },
  // /af-legacy deep-action gates. Each tab's preview/description content stays open to
  // everyone; only the actual analysis-trigger button (wrapped in FeatureGate at the call
  // site) requires AF Legacy. No token fallback for these — subscription only.
  {
    key: "legacy_trade_proposals",
    title: "Trade Command Center",
    accessType: "subscription_only",
    requiredPlanId: "war_room",
    tokenRuleCode: null,
    lockedReason: "Generating Chimmy trade proposals is part of AF Legacy.",
    backendEnforcement: "Server: requireFeatureEntitlement(legacy_trade_proposals) on POST /api/legacy/trade/proposal-generator (since 2026-11-16), /api/legacy/trade-ideas and /api/legacy/trade/goal-proposals (since 2026-11-17), plus the client FeatureGates around those three buttons in app/af-legacy/page.tsx.",
    frontendGateBehavior: "FeatureGate around the 'Generate Trade Proposals', Trade Ideas and Goal Proposals buttons.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/legacy?tab=trade"],
      components: [],
    },
  },
  {
    key: "legacy_trade_finder",
    title: "Trade Review",
    accessType: "subscription_only",
    /*
     * AF Pro (owner's decision 2026-11-16: "Trade Finder = AF Pro everywhere"). It was AF Legacy here while the
     * league trade finder and Chimmy's find_trade_ideas were AF Pro, so the same finder asked for two plans. The
     * key keeps its old name: the API cost gate, /api/trade-finder/matchmaking and TradeFinderV2 all read it.
     */
    requiredPlanId: "pro",
    tokenRuleCode: null,
    lockedReason: "Finding real trade opportunities against your roster is part of AF Pro.",
    backendEnforcement: "Server: aiCostGate trade_finder (POST /api/trade-finder) and requireFeatureEntitlement on POST /api/trade-finder/matchmaking. Since 2026-11-27 also the /core finder (GET /api/league/trade-finder) and the redraft Trade Center's partner search and package finder (/api/redraft/trades/discovery, /package-finder), through the `trade_finder` core depth (lib/core-app/coreDepthAccess.ts) — AF Pro and AF Supreme, not AF Commissioner alone. Client FeatureGate in components/TradeFinderV2.tsx (the AF Legacy finder tab). /trade-finder redirects to the Trades screen finder.",
    frontendGateBehavior: "FeatureGate around the 'Find Trades' / 'Find Best Partners' buttons.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/af-legacy?tab=finder"],
      components: ["TradeFinderV2"],
    },
  },
  {
    key: "legacy_waiver_analysis",
    title: "Waiver Chimmy",
    accessType: "subscription_only",
    requiredPlanId: "war_room",
    tokenRuleCode: null,
    lockedReason: "Full waiver-wire analysis is part of AF Legacy.",
    backendEnforcement: "Server: requireFeatureEntitlement(legacy_waiver_analysis) on POST /api/legacy/waiver/analyze (since 2026-11-16), plus the client FeatureGate around the action trigger in app/af-legacy/page.tsx.",
    frontendGateBehavior: "FeatureGate around the 'Analyze Free Agents' button.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/legacy?tab=waiver"],
      components: [],
    },
  },
  {
    key: "legacy_manager_compare",
    title: "Manager Comparison",
    accessType: "subscription_only",
    requiredPlanId: "war_room",
    tokenRuleCode: null,
    lockedReason: "Manager comparison analysis is part of AF Legacy.",
    backendEnforcement: "Server: requireFeatureEntitlement(legacy_manager_compare) on POST /api/legacy/compare (since 2026-11-16), plus the client FeatureGate around the action trigger in app/af-legacy/page.tsx.",
    frontendGateBehavior: "FeatureGate around the 'Compare Managers' button.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/af-legacy?tab=compare"],
      components: [],
    },
  },
  {
    key: "legacy_rankings_analysis",
    title: "Team Direction",
    accessType: "subscription_only",
    requiredPlanId: "war_room",
    tokenRuleCode: null,
    lockedReason: "Full team-direction rankings analysis is part of AF Legacy.",
    backendEnforcement: "Server: requireFeatureEntitlement(legacy_rankings_analysis) on POST /api/legacy/rankings/analyze (since 2026-11-16), plus the client FeatureGate around the action trigger in app/af-legacy/page.tsx.",
    frontendGateBehavior: "FeatureGate around the 'Show My Rankings' button.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/af-legacy?tab=rankings"],
      components: [],
    },
  },
  {
    key: "legacy_social_pulse",
    title: "Market Board",
    accessType: "subscription_only",
    requiredPlanId: "war_room",
    tokenRuleCode: null,
    lockedReason: "Live social/market pulse search is part of AF Legacy.",
    backendEnforcement: "Server: requireFeatureEntitlement(legacy_social_pulse) on POST /api/legacy/social-pulse (since 2026-11-16), plus the client FeatureGate around the action trigger in app/af-legacy/page.tsx.",
    frontendGateBehavior: "FeatureGate around the 'Get Social Pulse' button.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/af-legacy?tab=pulse"],
      components: [],
    },
  },
  // Owner's decision 2026-11-17: the four AF Legacy AI tools that ran free are locked. Trade Ideas and Goal
  // Proposals share legacy_trade_proposals (the Trade Command Center); these two get keys of their own so the
  // purchase funnel (from=lock_<key>) can tell them apart.
  {
    key: "legacy_trade_hub",
    title: "Trade Hub report",
    accessType: "subscription_only",
    requiredPlanId: "war_room",
    tokenRuleCode: null,
    lockedReason: "The full Chimmy trade report is part of AF Legacy.",
    backendEnforcement: "Server: requireFeatureEntitlement(legacy_trade_hub) on POST /api/legacy/trade/analyze (since 2026-11-17), plus the client FeatureGate around the Trade Hub's generate button in app/af-legacy/page.tsx.",
    frontendGateBehavior: "FeatureGate around the Trade Hub 'Analyze trade' button; the /af-legacy/trade-analyzer page shows the server's plan sentence.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/af-legacy?tab=trade", "/af-legacy/trade-analyzer"],
      components: [],
    },
  },
  {
    key: "legacy_ai_report",
    title: "Chimmy Analysis",
    accessType: "subscription_only",
    requiredPlanId: "war_room",
    tokenRuleCode: null,
    lockedReason: "Chimmy's read of your whole fantasy career is part of AF Legacy.",
    backendEnforcement: "Server: requireFeatureEntitlement(legacy_ai_report) on POST /api/legacy/ai/run (since 2026-11-17), plus a FeatureGate where the report renders in app/af-legacy/page.tsx.",
    frontendGateBehavior: "A locked card in place of the Chimmy Analysis report.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/af-legacy"],
      components: [],
    },
  },
  /*
   * Owner's decision 2026-11-27: the /af-legacy routes that called OpenAI for ANYONE (no session, `userId`
   * from the body — gating audit H1/H2) now need sign-in and AF Legacy, like the other deep tools above.
   * The deterministic parts stay free to a signed-in user: the trade's letter grade, the league preview.
   */
  {
    key: "legacy_trade_lookback",
    title: "Trade lookback",
    accessType: "subscription_only",
    requiredPlanId: "war_room",
    tokenRuleCode: null,
    lockedReason: "Chimmy's read on a past trade, and what you could have done instead, is part of AF Legacy.",
    backendEnforcement: "Server (2026-11-27): POST /api/legacy/trade-history `grade` needs a session and writes Chimmy's prose only for this plan (the letter grade stays free); POST /api/legacy/trade-alternatives needs a session and requireFeatureEntitlement(legacy_trade_lookback).",
    frontendGateBehavior: "TradeAlternatives shows the server's plan sentence with an upgrade link in place of the comparison.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/af-legacy?tab=trade"],
      components: ["TradeAlternatives"],
    },
  },
  {
    key: "legacy_portfolio_history",
    title: "Portfolio over time",
    accessType: "subscription_only",
    requiredPlanId: "war_room",
    tokenRuleCode: null,
    lockedReason: "Your trade portfolio over time is part of AF Legacy.",
    backendEnforcement: "Server (2026-11-28): GET /api/legacy/portfolio/history needs a session (401 sign_in_required), then requireFeatureEntitlement(legacy_portfolio_history) (403 feature_not_entitled) before any Sleeper read or grading.",
    frontendGateBehavior: "PortfolioChart shows the server's plan sentence with a sign-in or upgrade link in place of the chart.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/af-legacy"],
      components: ["PortfolioChart"],
    },
  },
  {
    key: "legacy_league_transfer",
    title: "League storylines",
    accessType: "subscription_only",
    requiredPlanId: "war_room",
    tokenRuleCode: null,
    lockedReason: "Chimmy's storylines and rivalry write-ups for your league are part of AF Legacy.",
    backendEnforcement: "Server (2026-11-27): POST /api/legacy/transfer needs a session; the two model calls (storylines, rivalry narratives) run only for this plan, everyone else gets the data-built storylines.",
    frontendGateBehavior: "A FeatureGate under the transfer preview names what AF Legacy adds.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/af-legacy?tab=transfer"],
      components: [],
    },
  },
  {
    key: "legacy_community_insights",
    title: "Chimmy news summary",
    accessType: "subscription_only",
    requiredPlanId: "war_room",
    tokenRuleCode: null,
    lockedReason: "Chimmy's summary of this week's news and injuries is part of AF Legacy.",
    backendEnforcement: "Server (2026-11-27): GET /api/legacy/community-insights?summarize=true (and /api/ai/community-insights) needs a session and requireFeatureEntitlement(legacy_community_insights); the plain news and injury lists stay public.",
    frontendGateBehavior: "FeatureGate around the 'Summarize' button in CommunityInsights.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/af-legacy"],
      components: ["CommunityInsights"],
    },
  },
] as const

const PREMIUM_FEATURE_MONETIZATION_MATRIX_BY_KEY: Record<
  SubscriptionFeatureId,
  PremiumFeatureMonetizationEntry
> = Object.fromEntries(
  PREMIUM_FEATURE_MONETIZATION_MATRIX.map((entry) => [entry.key, entry])
) as Record<SubscriptionFeatureId, PremiumFeatureMonetizationEntry>

const FEATURE_MONETIZATION_MATRIX: readonly FeatureMonetizationEntry[] = [
  ...FREE_FEATURE_MONETIZATION_MATRIX,
  ...PREMIUM_FEATURE_MONETIZATION_MATRIX,
]

export function listFeatureMonetizationMatrix(): FeatureMonetizationEntry[] {
  return FEATURE_MONETIZATION_MATRIX.map((entry) => ({ ...entry, surfaceHints: { ...entry.surfaceHints } }))
}

export function listPremiumFeatureMonetizationMatrix(): PremiumFeatureMonetizationEntry[] {
  return PREMIUM_FEATURE_MONETIZATION_MATRIX.map((entry) => ({
    ...entry,
    surfaceHints: { ...entry.surfaceHints },
  }))
}

export function getPremiumMonetizationForFeature(
  featureId: SubscriptionFeatureId
): PremiumFeatureMonetizationEntry | null {
  return PREMIUM_FEATURE_MONETIZATION_MATRIX_BY_KEY[featureId] ?? null
}

function getFeatureTokenFallbackRuleFromMatrix(
  featureId: SubscriptionFeatureId
): TokenSpendRuleCode | null {
  return getPremiumMonetizationForFeature(featureId)?.tokenRuleCode ?? null
}

export function getFeatureTokenCostFromMatrix(featureId: SubscriptionFeatureId): number | null {
  const ruleCode = getFeatureTokenFallbackRuleFromMatrix(featureId)
  if (!ruleCode) return null
  const rule = getTokenSpendRuleMatrixEntry(ruleCode)
  return rule?.tokenCost ?? null
}

export function getFeatureBuyTokensPathFromMatrix(featureId: SubscriptionFeatureId): string | null {
  const ruleCode = getFeatureTokenFallbackRuleFromMatrix(featureId)
  return buildTokenPath(ruleCode)
}
