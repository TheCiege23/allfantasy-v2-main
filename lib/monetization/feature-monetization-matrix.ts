import type { SubscriptionFeatureId, SubscriptionPlanId } from "@/lib/subscription/types"
import type { TokenSpendRuleCode } from "@/lib/tokens/constants"
import { getTokenSpendRuleMatrixEntry } from "@/lib/tokens/pricing-matrix"

export type MonetizationAccessType = "free" | "subscription_only" | "subscription_or_tokens"

export type MonetizationUnavailableBehavior = "show" | "disable_with_fallback" | "hide"

export type MonetizationSurfaceHints = {
  routes: string[]
  components: string[]
}

export type PremiumFeatureMonetizationEntry = {
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

export type FreeFeatureMonetizationEntry = {
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

export type FeatureMonetizationEntry =
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
  if (requiredPlanId === "war_room") {
    return `/war-room?feature=${encodeURIComponent(featureId)}`
  }
  if (requiredPlanId === "supreme") {
    return `/pricing?plan=supreme&feature=${encodeURIComponent(featureId)}`
  }
  return `/pricing?highlight=supreme&feature=${encodeURIComponent(featureId)}`
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
    title: "AI Chat",
    accessType: "subscription_or_tokens",
    requiredPlanId: "pro",
    tokenRuleCode: "ai_chimmy_chat_message",
    lockedReason: "AI Chat is part of AF Pro.",
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
    title: "AI Waivers",
    accessType: "subscription_or_tokens",
    requiredPlanId: "pro",
    tokenRuleCode: "ai_waiver_engine_run",
    lockedReason: "AI Waivers is part of AF Pro.",
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
    backendEnforcement: "requireFeatureEntitlement(planning_tools) on premium planning actions.",
    frontendGateBehavior: "FeatureGate + InContextMonetizationCard.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/af-legacy"],
      components: ["LegacyStrategyTab"],
    },
  },
  {
    key: "player_ai_recommendations",
    title: "Player AI Analysis",
    accessType: "subscription_or_tokens",
    requiredPlanId: "pro",
    tokenRuleCode: "ai_lineup_recommendation_explanation_single",
    lockedReason: "Player-specific AI analysis is part of AF Pro.",
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
    lockedReason: "Player comparison AI explanations are part of AF Pro.",
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
    title: "League AI Coaching",
    accessType: "subscription_only",
    requiredPlanId: "pro",
    tokenRuleCode: null,
    lockedReason: "League AI Coaching is part of AF Pro (monthly or yearly).",
    backendEnforcement: "requireFeatureEntitlement(league_ai_coaching) on POST /api/ai-tools/long-term-coaching; subscription-only (Stripe checkout: af_pro_monthly / af_pro_yearly).",
    frontendGateBehavior: "FeatureGate on league AI Coaching tab + Long-Term Coach modal.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/league/[leagueId]?view=ai_coaching"],
      components: ["AICoachingTab", "LongTermCoachingModal"],
    },
  },
  {
    key: "guillotine_ai",
    title: "Guillotine AI",
    accessType: "subscription_only",
    requiredPlanId: "pro",
    tokenRuleCode: null,
    lockedReason: "Guillotine AI is part of AF Pro.",
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
    title: "Salary Cap AI",
    accessType: "subscription_only",
    requiredPlanId: "pro",
    tokenRuleCode: null,
    lockedReason: "Salary Cap AI is part of AF Pro.",
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
    title: "Survivor AI (player)",
    accessType: "subscription_or_tokens",
    requiredPlanId: "pro",
    tokenRuleCode: "survivor_ai_vote_risk_quick",
    lockedReason: "Player-facing Survivor AI (lineups, mini-games, jury hints, confessionals) is part of AF Pro; some runs also burn AF Tokens.",
    backendEnforcement: "FeatureGate + token preflight for metered Survivor AI actions.",
    frontendGateBehavior: "Locked badge, tooltip, upgrade + token CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/survivor/[leagueId]", "/app/league/[leagueId]"],
      components: ["SurvivorPremiumCommandCenterPanel", "SurvivorAIPanel"],
    },
  },
  {
    key: "survivor_host_ai",
    title: "Survivor host AI",
    accessType: "subscription_or_tokens",
    requiredPlanId: "commissioner",
    tokenRuleCode: "survivor_ai_host_fairness_report",
    lockedReason: "Host and commissioner Survivor automation requires AF Commissioner (or AF Supreme). Heavy scans burn AF Tokens.",
    backendEnforcement: "requireFeatureEntitlement(survivor_host_ai) with token preflight on host routes.",
    frontendGateBehavior: "Premium command center tiles + upgrade CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/survivor/[leagueId]/commissioner"],
      components: ["SurvivorPremiumCommandCenterPanel", "SurvivorCommissionerDashboard"],
    },
  },
  {
    key: "big_brother_ai",
    title: "Big Brother AI (player)",
    accessType: "subscription_or_tokens",
    requiredPlanId: "pro",
    tokenRuleCode: "big_brother_ai_vote_prediction",
    lockedReason:
      "Player-facing Big Brother AI (vote reads, alliance scans, weekly recap) is part of AF Pro; deeper runs burn AF Tokens.",
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
    title: "Big Brother host AI",
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
    title: "Zombie AI",
    accessType: "subscription_only",
    requiredPlanId: "pro",
    tokenRuleCode: null,
    lockedReason: "Zombie AI is part of AF Pro.",
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
    title: "AI Collusion Detection",
    accessType: "subscription_or_tokens",
    requiredPlanId: "commissioner",
    tokenRuleCode: "commissioner_ai_collusion_detection_scan",
    lockedReason: "Collusion detection is part of AF Commissioner.",
    backendEnforcement: "requireFeatureEntitlement(ai_collusion_detection) with allowTokenFallback on scan endpoints.",
    frontendGateBehavior: "InContextMonetizationCard + token preview + upgrade/token CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/app/league/[leagueId]?tab=Commissioner"],
      components: ["AICommissionerPanel"],
    },
  },
  {
    key: "ai_tanking_detection",
    title: "AI Tanking Detection",
    accessType: "subscription_or_tokens",
    requiredPlanId: "commissioner",
    tokenRuleCode: "commissioner_ai_tanking_detection_scan",
    lockedReason: "Tanking detection is part of AF Commissioner.",
    backendEnforcement: "requireFeatureEntitlement(ai_tanking_detection) with allowTokenFallback on scan endpoints.",
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
    accessType: "subscription_or_tokens",
    requiredPlanId: "commissioner",
    tokenRuleCode: "ai_storyline_creation",
    lockedReason: "Storyline creation is part of AF Commissioner.",
    backendEnforcement: "requireFeatureEntitlement(storyline_creation) with allowTokenFallback.",
    frontendGateBehavior: "InContextMonetizationCard + upgrade/token CTA.",
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
    backendEnforcement: "requireFeatureEntitlement(draft_rankings) with allowTokenFallback on ranking explanation endpoints.",
    frontendGateBehavior: "Premium link + in-context card where draft-ranking actions execute.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/app/league/[leagueId]?tab=Draft"],
      components: ["CommissionerTab"],
    },
  },
  {
    key: "ai_team_managers",
    title: "AI Team Managers",
    accessType: "subscription_or_tokens",
    requiredPlanId: "commissioner",
    tokenRuleCode: "commissioner_ai_team_manager_actions",
    lockedReason: "AI team manager controls are part of AF Commissioner.",
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
    title: "AI Commissioner",
    accessType: "subscription_or_tokens",
    requiredPlanId: "commissioner",
    tokenRuleCode: "commissioner_ai_cycle_run",
    lockedReason: "AI Commissioner automation is part of AF Commissioner.",
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
    backendEnforcement: "requireFeatureEntitlement(draft_strategy_build) with token fallback on metered session actions.",
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
    backendEnforcement: "requireFeatureEntitlement(draft_prep) with allowTokenFallback.",
    frontendGateBehavior: "InContextMonetizationCard + upgrade/token CTA.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/league/[leagueId]/draft"],
      components: ["DraftHelperPanel"],
    },
  },
  {
    key: "future_planning",
    title: "Future-Year Planning",
    accessType: "subscription_or_tokens",
    requiredPlanId: "war_room",
    tokenRuleCode: "ai_strategy_3_5_year_planning",
    lockedReason: "Future-year planning is part of AF Legacy.",
    backendEnforcement: "requireFeatureEntitlement(future_planning) with token fallback where endpoint supports hybrid.",
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
    backendEnforcement: "requireFeatureEntitlement(multi_year_strategy) with token fallback where endpoint supports hybrid.",
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
    backendEnforcement: "requireFeatureEntitlement(draft_board_intelligence) with token fallback where endpoint supports hybrid.",
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
    backendEnforcement: "requireFeatureEntitlement(roster_construction_planning) with token fallback where endpoint supports hybrid.",
    frontendGateBehavior: "FeatureGate + in-context card where planning runs.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/war-room"],
      components: [],
    },
  },
  {
    key: "ai_planning_3_5_year",
    title: "3-5 Year AI Planning",
    accessType: "subscription_or_tokens",
    requiredPlanId: "war_room",
    tokenRuleCode: "ai_strategy_3_5_year_planning",
    lockedReason: "Long-horizon planning is part of AF Legacy.",
    backendEnforcement: "requireFeatureEntitlement(ai_planning_3_5_year) with token fallback where endpoint supports hybrid.",
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
    lockedReason: "Generating AI trade proposals is part of AF Legacy.",
    backendEnforcement: "Client-side FeatureGate around the action trigger in app/af-legacy/page.tsx.",
    frontendGateBehavior: "FeatureGate around the 'Generate Trade Proposals' button.",
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
    requiredPlanId: "war_room",
    tokenRuleCode: null,
    lockedReason: "Finding real trade opportunities against your roster is part of AF Legacy.",
    backendEnforcement: "Client-side FeatureGate around the action trigger in components/TradeFinderV2.tsx.",
    frontendGateBehavior: "FeatureGate around the 'Find Trades' / 'Find Best Partners' buttons.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/af-legacy?tab=finder"],
      components: ["TradeFinderV2"],
    },
  },
  {
    key: "legacy_waiver_analysis",
    title: "Waiver AI",
    accessType: "subscription_only",
    requiredPlanId: "war_room",
    tokenRuleCode: null,
    lockedReason: "Full waiver-wire analysis is part of AF Legacy.",
    backendEnforcement: "Client-side FeatureGate around the action trigger in app/af-legacy/page.tsx.",
    frontendGateBehavior: "FeatureGate around the 'Analyze Free Agents' button.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/legacy?tab=waiver"],
      components: [],
    },
  },
  {
    key: "legacy_manager_compare",
    title: "Opponent Behavior",
    accessType: "subscription_only",
    requiredPlanId: "war_room",
    tokenRuleCode: null,
    lockedReason: "Manager comparison analysis is part of AF Legacy.",
    backendEnforcement: "Client-side FeatureGate around the action trigger in app/af-legacy/page.tsx.",
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
    backendEnforcement: "Client-side FeatureGate around the action trigger in app/af-legacy/page.tsx.",
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
    backendEnforcement: "Client-side FeatureGate around the action trigger in app/af-legacy/page.tsx.",
    frontendGateBehavior: "FeatureGate around the 'Get Social Pulse' button.",
    unavailableBehavior: "disable_with_fallback",
    surfaceHints: {
      routes: ["/af-legacy?tab=pulse"],
      components: [],
    },
  },
] as const

const PREMIUM_FEATURE_MONETIZATION_MATRIX_BY_KEY: Record<
  SubscriptionFeatureId,
  PremiumFeatureMonetizationEntry
> = Object.fromEntries(
  PREMIUM_FEATURE_MONETIZATION_MATRIX.map((entry) => [entry.key, entry])
) as Record<SubscriptionFeatureId, PremiumFeatureMonetizationEntry>

export const FEATURE_MONETIZATION_MATRIX: readonly FeatureMonetizationEntry[] = [
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

export function getFeatureTokenFallbackRuleFromMatrix(
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
