import type { SubscriptionPlanFamily } from '@/lib/monetization/catalog'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'

/** @deprecated Import SubscriptionFeatureId from @/lib/subscription/types — same union. */
export type FeatureKey = SubscriptionFeatureId

export type PlanFamily = 'free' | SubscriptionPlanFamily

export type EntitlementDef = {
  key: SubscriptionFeatureId
  label: string
  description: string
  requiredPlan: SubscriptionPlanFamily[]
  upgradeUrl: string
  upgradeLabel: string
  highlightParam?: string
}

export const ENTITLEMENTS = {
  manager_psychology: {
    key: 'manager_psychology',
    label: 'Manager Psychology',
    description:
      'How the other managers in your league draft and trade, built only from behaviour actually recorded in that league. Your own profile is always free.',
    // Pro and War Room both stand on their own here, and Supreme inherits both.
    // War Room is not a superset of Pro, so naming Pro alone would have locked
    // out every War Room subscriber for a feature that is squarely draft- and
    // trade-room intelligence.
    requiredPlan: ['af_pro', 'af_war_room', 'af_supreme'],
    upgradeUrl: '/pricing',
    upgradeLabel: 'Unlock Manager Psychology',
    highlightParam: 'manager_psychology',
  },
  commissioner_ai_tools: {
    key: 'commissioner_ai_tools',
    label: 'Commissioner AI Tools',
    description:
      'AI-powered league management tools including ceremony narration, weekly recaps, and commissioner copilot.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
    highlightParam: 'ai_tools',
  },
  commissioner_ai_narration: {
    key: 'commissioner_ai_narration',
    label: 'AI Ceremony Narration',
    description:
      'Chimmy writes dramatic HOH, eviction, and finale ceremonies for your Big Brother league.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
    highlightParam: 'ai_narration',
  },
  commissioner_ai_recap: {
    key: 'commissioner_ai_recap',
    label: 'AI Weekly Recaps',
    description: 'Automated episode and weekly league recaps with commissioner tone controls.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
    highlightParam: 'ai_recap',
  },
  commissioner_ai_copilot: {
    key: 'commissioner_ai_copilot',
    label: 'Commissioner Copilot',
    description: 'Context-aware suggestions for league decisions, settings, and member communication.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
    highlightParam: 'ai_copilot',
  },
  commissioner_ai_jury_briefing: {
    key: 'commissioner_ai_jury_briefing',
    label: 'Jury Briefing AI',
    description: 'Structured jury-phase analysis and narrative support for finale voting context.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
  },
  commissioner_nomination_analysis: {
    key: 'commissioner_nomination_analysis',
    label: 'HOH Nomination Analysis',
    description: 'Private AI analysis of who to nominate based on threat level and jury implications.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
  },
  commissioner_pov_analysis: {
    key: 'commissioner_pov_analysis',
    label: 'POV Strategy Analysis',
    description: 'AI-assisted veto week planning and backdoor risk assessment.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
  },
  commissioner_devy_scouting: {
    key: 'commissioner_devy_scouting',
    label: 'Devy Scouting AI',
    description: 'Prospect evaluation, declaration-year projections, and pipeline health analysis.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
  },
  commissioner_cap_advice: {
    key: 'commissioner_cap_advice',
    label: 'Cap Space AI Advice',
    description:
      'AI-powered salary cap recommendations including cut candidates, extension targets, and cap burden warnings.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
  },
  commissioner_weather_projections: {
    key: 'commissioner_weather_projections',
    label: 'AF Weather Projections',
    description: 'AI-adjusted projections based on live weather data for outdoor sports.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
    highlightParam: 'weather',
  },
  commissioner_power_rankings: {
    key: 'commissioner_power_rankings',
    label: 'AI Power Rankings',
    description: 'Chimmy generates league-wide power rankings with per-team reasoning each week.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
    highlightParam: 'power_rankings',
  },
  commissioner_fairness_audit: {
    key: 'commissioner_fairness_audit',
    label: 'League Fairness Audit',
    description: 'AI monitors voting patterns and nomination trends to flag potential fairness issues.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
  },
  commissioner_constitution_generator: {
    key: 'commissioner_constitution_generator',
    label: 'Constitution Generator',
    description: 'AI writes a full league constitution based on your current settings.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
  },
  commissioner_idp_analysis: {
    key: 'commissioner_idp_analysis',
    label: 'IDP AI Analysis',
    description: 'Chimmy-powered IDP start/sit, waiver, and matchup tools for your league.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
    highlightParam: 'idp_ai',
  },
  commissioner_c2c_scouting: {
    key: 'commissioner_c2c_scouting',
    label: 'C2C Scouting AI',
    description: 'Campus-to-campus scouting, taxi transition advice, and combined NFL/CFB context.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
    highlightParam: 'c2c_ai',
  },
  commissioner_dispersal_draft: {
    key: 'commissioner_dispersal_draft',
    label: 'Dispersal Draft',
    description:
      'Set up and run a dispersal draft for orphaned teams or league downsizing. Requires AF Commissioner subscription.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
    highlightParam: 'dispersal_draft',
  },
  commissioner_integrity_monitoring: {
    key: 'commissioner_integrity_monitoring',
    label: 'Integrity Monitoring',
    description:
      'AI-powered anti-collusion and anti-tanking monitoring for your leagues. Automatically analyzes trades and weekly lineups for suspicious patterns using on-field data only.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
    highlightParam: 'integrity_monitoring',
  },
  pro_draft_ai: {
    key: 'pro_draft_ai',
    label: 'AI Draft Assistant',
    description: 'Chimmy-powered draft board help with tier breaks and positional scarcity.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
    highlightParam: 'draft_ai',
  },
  pro_waiver_ai: {
    key: 'pro_waiver_ai',
    label: 'AI Waiver Targets',
    description: 'AI-ranked waiver wire targets based on your league scoring and roster needs.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
    highlightParam: 'waiver_ai',
  },
  commissioner_waiver_ai: {
    key: 'commissioner_waiver_ai',
    label: 'Commissioner Waiver AI',
    description: 'AI-powered league-wide waiver tools: settings health check, suspicious behavior detection, collusion risk, and fairness analysis.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/pricing',
    upgradeLabel: 'Get AF Commissioner',
    highlightParam: 'commissioner_waiver_ai',
  },
  pro_trade_ai: {
    key: 'pro_trade_ai',
    label: 'AI Trade Analyzer',
    description: 'Evaluate trade offers with AI-powered win-now vs future value analysis.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
    highlightParam: 'trade_ai',
  },
  pro_lineup_optimizer: {
    key: 'pro_lineup_optimizer',
    label: 'AI Lineup Optimizer',
    description:
      'Chimmy sets your optimal starting lineup based on projections, matchups, and injury news.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
    highlightParam: 'lineup_optimizer',
  },
  pro_start_sit: {
    key: 'pro_start_sit',
    label: 'AI Start/Sit',
    description: 'Chimmy gives you personalized start/sit recommendations based on your roster and matchup.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
    highlightParam: 'start_sit',
  },
  pro_matchup_analysis: {
    key: 'pro_matchup_analysis',
    label: 'Matchup Analysis',
    description: 'AI analysis of your weekly matchup including threat assessment and scoring projections.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
    highlightParam: 'matchup',
  },
  pro_player_comparison: {
    key: 'pro_player_comparison',
    label: 'AI Player Comparison',
    description: 'Side-by-side player outlooks with rest-of-season and weekly context.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
  },
  pro_af_projections: {
    key: 'pro_af_projections',
    label: 'AF Crest Projections',
    description: 'AI-adjusted projections including weather and contextual factors shown on player cards.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
    highlightParam: 'af_projections',
  },
  pro_snap_analysis: {
    key: 'pro_snap_analysis',
    label: 'Snap & Usage Analysis',
    description: 'Trend-based snap and usage explanations tied to your scoring format.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
  },
  pro_autocoach: {
    key: 'pro_autocoach',
    label: 'AI Auto Start/Sit Protection',
    description:
      'Pre-lock automation: swaps clearly unavailable starters using live status and Start/Sit projections. Per-player game locks — not Best Ball, not in-game fixes.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
    highlightParam: 'autocoach',
  },
  war_room_dynasty_projections: {
    key: 'war_room_dynasty_projections',
    label: 'Dynasty Projections',
    description: 'Multi-year dynasty value projections with confidence scoring.',
    requiredPlan: ['af_war_room', 'af_supreme'],
    upgradeUrl: '/war-room',
    upgradeLabel: 'Get AF Legacy',
    highlightParam: 'dynasty_projections',
  },
  war_room_devy_rankings: {
    key: 'war_room_devy_rankings',
    label: 'Devy Rankings',
    description: 'AI-generated college player rankings with campus scoring and pro projection scores.',
    requiredPlan: ['af_war_room', 'af_supreme'],
    upgradeUrl: '/war-room',
    upgradeLabel: 'Get AF Legacy',
  },
  war_room_draft_strategy: {
    key: 'war_room_draft_strategy',
    label: 'Draft Strategy AI',
    description: 'Real-time draft board advice with tier-break alerts and positional scarcity callouts.',
    requiredPlan: ['af_war_room', 'af_supreme'],
    upgradeUrl: '/war-room',
    upgradeLabel: 'Get AF Legacy',
    highlightParam: 'draft_strategy',
  },
  war_room_pipeline_analysis: {
    key: 'war_room_pipeline_analysis',
    label: 'Pipeline Health Analysis',
    description: "AI assessment of your dynasty roster's campus/taxi/active pipeline health.",
    requiredPlan: ['af_war_room', 'af_supreme'],
    upgradeUrl: '/war-room',
    upgradeLabel: 'Get AF Legacy',
  },
} as const satisfies Record<string, EntitlementDef>

export function getEntitlement(key: SubscriptionFeatureId): EntitlementDef {
  const def = (ENTITLEMENTS as Record<string, EntitlementDef | undefined>)[key]
  if (def) return def
  throw new Error(`Unknown entitlement catalog entry: ${key}`)
}

export function canUseFeature(
  featureKey: SubscriptionFeatureId,
  userPlan: PlanFamily | null | undefined
): boolean {
  if (!userPlan || userPlan === 'free') return false
  const def = (ENTITLEMENTS as Record<string, EntitlementDef | undefined>)[featureKey]
  if (!def?.requiredPlan.length) return false
  if (userPlan === 'af_supreme') {
    return def.requiredPlan.some((p) =>
      ['af_pro', 'af_commissioner', 'af_war_room', 'af_supreme'].includes(p)
    )
  }
  return def.requiredPlan.includes(userPlan as SubscriptionPlanFamily)
}

export function getUpgradeUrl(featureKey: SubscriptionFeatureId): string {
  return (ENTITLEMENTS as Record<string, EntitlementDef | undefined>)[featureKey]?.upgradeUrl ?? '/upgrade'
}

/** League settings modal AI tab / sub-panel id → entitlement key (402 + upgrade UX). */
export const LEAGUE_SETTINGS_AI_PANEL_FEATURE: Record<string, SubscriptionFeatureId> = {
  'ai-chimmy-setup': 'commissioner_ai_tools',
  'ai-power-rankings': 'commissioner_power_rankings',
  'ai-trade': 'pro_trade_ai',
  'ai-waiver': 'pro_waiver_ai',
  'ai-recap': 'commissioner_ai_recap',
  'ai-draft-help': 'pro_draft_ai',
  'ai-matchup': 'pro_matchup_analysis',
  'ai-trash': 'pro_start_sit',
}

/** Maps `?highlight=` query keys to plan cards on pricing surfaces (scroll + ring). */
export const HIGHLIGHT_TO_PLAN_FAMILY: Record<string, SubscriptionPlanFamily> = {
  supreme: 'af_supreme',
  ai_tools: 'af_commissioner',
  ai_narration: 'af_commissioner',
  ai_recap: 'af_commissioner',
  ai_copilot: 'af_commissioner',
  weather: 'af_commissioner',
  power_rankings: 'af_commissioner',
  idp_ai: 'af_commissioner',
  c2c_ai: 'af_commissioner',
  draft_ai: 'af_pro',
  waiver_ai: 'af_pro',
  trade_ai: 'af_pro',
  lineup_optimizer: 'af_pro',
  start_sit: 'af_pro',
  matchup: 'af_pro',
  af_projections: 'af_pro',
  autocoach: 'af_pro',
  dynasty_projections: 'af_war_room',
  draft_strategy: 'af_war_room',
}
