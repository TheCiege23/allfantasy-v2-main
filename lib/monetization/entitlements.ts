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
    // 🛑 The KEY stays `manager_psychology` — it is the feature id gates and the plan matrix read.
    // The copy describes what the plan actually opens today: Competitive Edge, the other managers'
    // own recorded moves beside your decision. No profile, archetype or label (Milestone 32), and no
    // "your own profile" — there is none to give away.
    label: 'Competitive Edge',
    description:
      "What the other managers in your league have actually done there — their trades, draft picks and waiver bids — shown beside your own trade, draft and waiver decisions.",
    // Pro and War Room both stand on their own here, and Supreme inherits both.
    // War Room is not a superset of Pro, so naming Pro alone would have locked
    // out every War Room subscriber for a feature that is squarely draft- and
    // trade-room intelligence.
    // AF Commissioner added 2026-11-22 (owner: "all high level functions … covered by AF Pro, Supreme or
    // Commissioner").
    requiredPlan: ['af_pro', 'af_commissioner', 'af_war_room', 'af_supreme'],
    // AF Pro: the broadest plan that includes it. `/pricing` was a grid with nothing picked out.
    upgradeUrl: '/pro',
    upgradeLabel: 'Unlock Competitive Edge',
    highlightParam: 'manager_psychology',
  },
  commissioner_draft_as_me: {
    key: 'commissioner_draft_as_me',
    label: 'Draft As Me',
    description:
      'When a manager misses a pick, Chimmy drafts the way that manager drafts: their usual reach or patience and the positions they favour. Requires AF Commissioner subscription.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
    highlightParam: 'draft_as_me',
  },
  commissioner_ai_tools: {
    key: 'commissioner_ai_tools',
    label: 'Commissioner Chimmy Tools',
    description:
      'Chimmy-powered league management tools including ceremony narration, weekly recaps, and commissioner copilot.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
    highlightParam: 'ai_tools',
  },
  commissioner_ai_narration: {
    key: 'commissioner_ai_narration',
    label: 'Chimmy Ceremony Narration',
    description:
      'Chimmy writes dramatic HOH, eviction, and finale ceremonies for your Big Brother league.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
    highlightParam: 'ai_narration',
  },
  commissioner_ai_recap: {
    key: 'commissioner_ai_recap',
    label: 'Chimmy Weekly Recaps',
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
    label: 'Jury Briefing Chimmy',
    description: 'Structured jury-phase analysis and narrative support for finale voting context.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
  },
  commissioner_nomination_analysis: {
    key: 'commissioner_nomination_analysis',
    label: 'HOH Nomination Analysis',
    description: 'Private Chimmy analysis of who to nominate based on threat level and jury implications.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
  },
  commissioner_pov_analysis: {
    key: 'commissioner_pov_analysis',
    label: 'POV Strategy Analysis',
    description: 'Chimmy-assisted veto week planning and backdoor risk assessment.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
  },
  commissioner_devy_scouting: {
    key: 'commissioner_devy_scouting',
    label: 'Devy Scouting Chimmy',
    description: 'Prospect evaluation, declaration-year projections, and pipeline health analysis.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
  },
  commissioner_cap_advice: {
    key: 'commissioner_cap_advice',
    label: 'Cap Space Chimmy Advice',
    description:
      'Chimmy-powered salary cap recommendations including cut candidates, extension targets, and cap burden warnings.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
  },
  commissioner_weather_projections: {
    key: 'commissioner_weather_projections',
    label: 'AF Weather Projections',
    description: 'Chimmy-adjusted projections based on live weather data for outdoor sports.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
    highlightParam: 'weather',
  },
  commissioner_power_rankings: {
    key: 'commissioner_power_rankings',
    label: 'Chimmy Power Rankings',
    description: 'Chimmy generates league-wide power rankings with per-team reasoning each week.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
    highlightParam: 'power_rankings',
  },
  commissioner_fairness_audit: {
    key: 'commissioner_fairness_audit',
    label: 'League Fairness Audit',
    description: 'Chimmy monitors voting patterns and nomination trends to flag potential fairness issues.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
  },
  commissioner_constitution_generator: {
    key: 'commissioner_constitution_generator',
    label: 'Constitution Generator',
    description: 'Chimmy writes a full league constitution based on your current settings.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
  },
  commissioner_idp_analysis: {
    key: 'commissioner_idp_analysis',
    label: 'IDP Chimmy Analysis',
    description: 'Chimmy-powered IDP start/sit, waiver, and matchup tools for your league.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
    highlightParam: 'idp_ai',
  },
  commissioner_c2c_scouting: {
    key: 'commissioner_c2c_scouting',
    label: 'C2C Scouting Chimmy',
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
  commissioner_chimmy_autopilot: {
    key: 'commissioner_chimmy_autopilot',
    label: 'Chimmy Autopilot',
    description:
      'Chimmy runs a team — drafting for it and managing it — whose manager has left or gone quiet, playing like a dynasty owner until someone takes over. Part of AF Pro and AF Supreme (owner decision 2026-11-22; it was AF Commissioner).',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
    highlightParam: 'chimmy_autopilot',
  },
  commissioner_integrity_monitoring: {
    key: 'commissioner_integrity_monitoring',
    label: 'Integrity Monitoring',
    description:
      'Chimmy-powered anti-collusion and anti-tanking monitoring for your leagues. Automatically analyzes trades and weekly lineups for suspicious patterns using on-field data only.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
    highlightParam: 'integrity_monitoring',
  },
  pro_draft_ai: {
    key: 'pro_draft_ai',
    label: 'Chimmy Draft Assistant',
    description: 'Chimmy-powered draft board help with tier breaks and positional scarcity.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
    highlightParam: 'draft_ai',
  },
  pro_waiver_ai: {
    key: 'pro_waiver_ai',
    label: 'Chimmy Waiver Targets',
    description: 'Chimmy-ranked waiver wire targets based on your league scoring and roster needs.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
    highlightParam: 'waiver_ai',
  },
  commissioner_waiver_ai: {
    key: 'commissioner_waiver_ai',
    label: 'Commissioner Waiver Chimmy',
    description: 'Chimmy-powered league-wide waiver tools: settings health check, suspicious behavior detection, collusion risk, and fairness analysis.',
    requiredPlan: ['af_commissioner', 'af_supreme'],
    upgradeUrl: '/commissioner-upgrade',
    upgradeLabel: 'Get AF Commissioner',
    highlightParam: 'commissioner_waiver_ai',
  },
  pro_trade_ai: {
    key: 'pro_trade_ai',
    label: 'Chimmy Trade Analyzer',
    description: 'Evaluate trade offers with Chimmy-powered win-now vs future value analysis.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
    highlightParam: 'trade_ai',
  },
  pro_lineup_optimizer: {
    key: 'pro_lineup_optimizer',
    label: 'Chimmy Lineup Optimizer',
    description:
      'Chimmy sets your optimal starting lineup based on projections, matchups, and injury news.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
    highlightParam: 'lineup_optimizer',
  },
  pro_start_sit: {
    key: 'pro_start_sit',
    label: 'Chimmy Start/Sit',
    description: 'Chimmy gives you personalized start/sit recommendations based on your roster and matchup.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
    highlightParam: 'start_sit',
  },
  pro_matchup_analysis: {
    key: 'pro_matchup_analysis',
    label: 'Matchup Analysis',
    description: 'Chimmy analysis of your weekly matchup including threat assessment and scoring projections.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
    highlightParam: 'matchup',
  },
  pro_player_comparison: {
    key: 'pro_player_comparison',
    label: 'Chimmy Player Comparison',
    description: 'Side-by-side player outlooks with rest-of-season and weekly context.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
  },
  /*
   * AF INTELLIGENCE (owner's decision, 2026-11-22): "all high level functions that come from Chimmy and
   * the OS system should be covered by AF Pro, Supreme or Commissioner". ONE key for all three plans, so
   * no surface has to remember the list: AF projections (the engine's number and its measured factors),
   * AF ADP, the full trade breakdown and player deep dives (CORE_DEPTH), and Chimmy's deep answers.
   * Not in the plan matrix on purpose — the matrix accepts exactly one plan.
   */
  af_intelligence: {
    key: 'af_intelligence',
    label: 'AF projections, AF ADP and the full answers',
    description:
      "AllFantasy's own projections and ADP, every trade grade's full breakdown, player deep dives and Chimmy's complete answers. Included with AF Pro, AF Commissioner and AF Supreme.",
    requiredPlan: ['af_pro', 'af_commissioner', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
    highlightParam: 'af_intelligence',
  },
  pro_af_projections: {
    key: 'pro_af_projections',
    label: 'AF Crest Projections',
    description: 'Chimmy-adjusted projections including weather and contextual factors shown on player cards.',
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
    label: 'Chimmy Auto Start/Sit Protection',
    description:
      'Pre-lock automation: swaps clearly unavailable starters using live status and Start/Sit projections. Per-player game locks — not Best Ball, not in-game fixes.',
    requiredPlan: ['af_pro', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
    highlightParam: 'autocoach',
  },
  /*
   * The finder tab INSIDE /af-legacy (owner's decision 2026-11-27, gating audit I3). A Legacy buyer hit an
   * AF Pro lock (`legacy_trade_finder`) in their own product. This key is that rule plus AF Legacy, and is
   * read ONLY by the /af-legacy finder (TradeFinderV2 → /api/trade-finder, /api/trade-finder/matchmaking).
   * The /core and redraft finders keep `legacy_trade_finder` (AF Pro, AF Supreme). Not in the plan matrix
   * on purpose — the matrix accepts exactly one plan.
   */
  legacy_tab_trade_finder: {
    key: 'legacy_tab_trade_finder',
    label: 'Trade Finder',
    description:
      'Real trade opportunities and the best partners for your roster, inside AF Legacy. Included with AF Pro, AF Legacy and AF Supreme.',
    requiredPlan: ['af_pro', 'af_war_room', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
  },
  /*
   * The draft room's Chimmy pick explanation (owner's decision 2026-11-28). It was `draft_prep` (AF Legacy;
   * Supreme inherits Legacy since 2026-11-27), which locked AF Pro out of an explanation of a redraft pick.
   * Legacy-only payers keep it; AF Pro gains it; AF Commissioner alone does not. Read by
   * POST /api/draft/recommend (includeAIExplanation, token fallback `ai_draft_pick_explanation` passed
   * explicitly at the call site) and the draft-room lock cards. Not in the plan matrix on purpose — the
   * matrix accepts exactly one plan.
   */
  draft_room_ai_explanation: {
    key: 'draft_room_ai_explanation',
    label: 'Draft-room pick explanation',
    description:
      "Chimmy's explanation of the draft room's recommended pick. Included with AF Pro, AF Legacy and AF Supreme.",
    requiredPlan: ['af_pro', 'af_war_room', 'af_supreme'],
    upgradeUrl: '/pro',
    upgradeLabel: 'Get AF Pro',
  },
  war_room_dynasty_projections: {
    key: 'war_room_dynasty_projections',
    label: 'Dynasty Projections',
    description: 'Multi-year dynasty value projections with confidence scoring.',
    requiredPlan: ['af_war_room'],
    // Not `/war-room`: that is the product page, and it cannot take a payment.
    upgradeUrl: '/upgrade?plan=war_room',
    upgradeLabel: 'Get AF Legacy',
    highlightParam: 'dynasty_projections',
  },
  war_room_devy_rankings: {
    key: 'war_room_devy_rankings',
    label: 'Devy Rankings',
    description: 'Chimmy-generated college player rankings with campus scoring and pro projection scores.',
    requiredPlan: ['af_war_room'],
    upgradeUrl: '/upgrade?plan=war_room',
    upgradeLabel: 'Get AF Legacy',
  },
  war_room_draft_strategy: {
    key: 'war_room_draft_strategy',
    label: 'Draft Strategy Chimmy',
    description: 'Real-time draft board advice with tier-break alerts and positional scarcity callouts.',
    requiredPlan: ['af_war_room'],
    upgradeUrl: '/upgrade?plan=war_room',
    upgradeLabel: 'Get AF Legacy',
    highlightParam: 'draft_strategy',
  },
  war_room_pipeline_analysis: {
    key: 'war_room_pipeline_analysis',
    label: 'Pipeline Health Analysis',
    description: "Chimmy assessment of your dynasty roster's campus/taxi/active pipeline health.",
    requiredPlan: ['af_war_room'],
    upgradeUrl: '/upgrade?plan=war_room',
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
  // 'ai-trash' is not here on purpose: trash talk is free and capped since 2026-11-27 (it borrowed
  // `pro_start_sit` by accident). It never answers 402/403, so it needs no upgrade key.
}

/** Maps `?highlight=` query keys to plan cards on pricing surfaces (scroll + ring). */
export const HIGHLIGHT_TO_PLAN_FAMILY: Record<string, SubscriptionPlanFamily> = {
  draft_as_me: 'af_commissioner',
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
  af_intelligence: 'af_pro',
  autocoach: 'af_pro',
  dynasty_projections: 'af_war_room',
  draft_strategy: 'af_war_room',
  manager_psychology: 'af_pro',
  dispersal_draft: 'af_commissioner',
  integrity_monitoring: 'af_commissioner',
  chimmy_autopilot: 'af_pro',
  commissioner_waiver_ai: 'af_commissioner',
}
