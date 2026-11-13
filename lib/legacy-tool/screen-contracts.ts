import type { EnrichedLegacyContext, LeagueSnapshot } from '@/lib/legacy-ai-context'
import type { DraftWarRoomInput, LegacyOffseasonBundle, LegacyReportSignal } from '@/lib/legacy-tool/offseason'

export type LegacyScreenName =
  | 'offseason_dashboard'
  | 'draft_war_room'
  | 'trade_command_center'

type LegacyEnvelopeStatus = 'ok' | 'insufficient_data'

interface LegacyScreenMeta {
  ai_stack: {
    orchestrator: 'openai'
    structured_evaluator: 'deepseek'
    live_news_overlay: 'grok'
  }
  confidence: number
  needs_refresh_after: string
  used_live_news_overlay: boolean
  used_simulation: boolean
  missing_fields?: string[]
}

export interface LegacyScreenEnvelope<TData> {
  status: LegacyEnvelopeStatus
  request_id: string
  screen: LegacyScreenName
  data: TData | null
  meta: LegacyScreenMeta
  errors: Array<{ code: string; message: string }>
}

type ContractBuildArgs = {
  requestId: string
  screen: LegacyScreenName
  data: unknown
  confidence: number
  usedSimulation: boolean
  usedLiveNewsOverlay: boolean
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.max(0, Math.min(1, value))
}

function clamp0to100(value: number): number {
  if (!Number.isFinite(value)) return 50
  return Math.max(0, Math.min(100, value))
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function isoPlusMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

function normalizeDirectionLabel(label: string): 'contender' | 'fringe' | 'retool' | 'rebuild' {
  const text = (label || '').toLowerCase()
  if (text.includes('all-in') || text.includes('contender')) return text.includes('1-2 holes') ? 'fringe' : 'contender'
  if (text.includes('full rebuild') || text.includes('soft rebuild')) return 'rebuild'
  return 'retool'
}

function toNeedReason(need: string): string {
  const n = need.toUpperCase()
  if (n.includes('RB')) return 'You lack stable weekly RB volume and insulation.'
  if (n.includes('QB')) return 'QB stability is thin for your lineup and scoring format.'
  if (n.includes('TE')) return 'TE room lacks either stable floor or upside insulation.'
  if (n.includes('WR')) return 'WR room can be improved through consolidation into stronger weekly options.'
  return 'This area currently underperforms relative to your competitive window.'
}

function buildMeta(args: {
  confidence: number
  usedSimulation: boolean
  usedLiveNewsOverlay: boolean
  missingFields?: string[]
}): LegacyScreenMeta {
  return {
    ai_stack: {
      orchestrator: 'openai',
      structured_evaluator: 'deepseek',
      live_news_overlay: 'grok',
    },
    confidence: clamp01(args.confidence),
    needs_refresh_after: isoPlusMinutes(30),
    used_live_news_overlay: args.usedLiveNewsOverlay,
    used_simulation: args.usedSimulation,
    ...(args.missingFields && args.missingFields.length ? { missing_fields: args.missingFields } : {}),
  }
}

export function buildOkEnvelope<TData>(args: ContractBuildArgs): LegacyScreenEnvelope<TData> {
  return {
    status: 'ok',
    request_id: args.requestId,
    screen: args.screen,
    data: args.data as TData,
    meta: buildMeta({
      confidence: args.confidence,
      usedSimulation: args.usedSimulation,
      usedLiveNewsOverlay: args.usedLiveNewsOverlay,
    }),
    errors: [],
  }
}

export function buildInsufficientDataEnvelope(args: {
  requestId: string
  screen: LegacyScreenName
  missingFields: string[]
  message: string
  usedLiveNewsOverlay?: boolean
}): LegacyScreenEnvelope<null> {
  return {
    status: 'insufficient_data',
    request_id: args.requestId,
    screen: args.screen,
    data: null,
    meta: buildMeta({
      confidence: 0.35,
      usedSimulation: false,
      usedLiveNewsOverlay: Boolean(args.usedLiveNewsOverlay),
      missingFields: args.missingFields,
    }),
    errors: [
      {
        code: 'MISSING_REQUIRED_CONTEXT',
        message: args.message,
      },
    ],
  }
}

function getLatestRosterContext(enrichedContext: EnrichedLegacyContext | null) {
  if (!enrichedContext?.currentRosters?.length) return null
  return [...enrichedContext.currentRosters].sort((a, b) => b.season - a.season)[0]
}

export function buildOffseasonDashboardData(args: {
  snapshot: LeagueSnapshot
  offseason: LegacyOffseasonBundle
  enrichedContext: EnrichedLegacyContext | null
  reportSignal?: LegacyReportSignal
  userId: string
}): Record<string, unknown> {
  const roster = getLatestRosterContext(args.enrichedContext)
  const strengths = args.offseason.team_reality_check.strengths
  const weaknesses = args.offseason.team_reality_check.weaknesses
  const priorities = args.offseason.team_reality_check.biggest_offseason_priorities
  const breakout = args.offseason.player_market_board.breakout_watch
  const decline = args.offseason.player_market_board.decline_watch
  const holdCandidates = args.offseason.ai_gm_plan.hold_moves
  const cutCandidates = args.offseason.team_reality_check.dead_roster_spots
  const tradeTargets = args.offseason.trade_command_center.best_targets.buy_low_targets
  const sellHigh = args.offseason.trade_command_center.best_targets.sell_high_candidates
  const waiverStashes = args.offseason.player_market_board.acquisition_watch

  const contenderScore = clamp0to100(args.offseason.team_reality_check.contender_score)
  const rebuildScore = clamp0to100(args.offseason.team_reality_check.rebuild_score)
  const ageCurveScore = clamp0to100(100 - Math.abs(contenderScore - rebuildScore) * 0.4)
  const benchDepthScore = clamp0to100(100 - cutCandidates.length * 12)
  const futureAssetScore = clamp0to100(args.offseason.team_reality_check.draft_capital_strength)
  const tradeFlexScore = clamp0to100(args.offseason.team_reality_check.trade_flexibility)

  const direction = normalizeDirectionLabel(args.offseason.team_direction_engine.label)
  const leagueContext = {
    league_id: String((args.snapshot.league_history?.[0] as Record<string, unknown> | undefined)?.id || 'unknown_league'),
    sport: 'NFL',
    format: 'dynasty',
    scoring_type: roster?.isSF ? 'superflex_ppr' : 'ppr',
    superflex: Boolean(roster?.isSF),
    te_premium: Boolean(roster?.isTEP),
    teams: Number(roster?.teamCount || 12),
    roster_size: (roster?.starters.length || 0) + (roster?.bench.length || 0) + (roster?.taxi.length || 0) + (roster?.ir.length || 0),
  }

  return {
    screen: 'offseason_dashboard',
    version: '1.0',
    generated_at: new Date().toISOString(),
    league_context: leagueContext,
    team_context: {
      user_id: args.userId,
      team_id: 'team_owner',
      team_name: args.snapshot.username,
      team_direction: {
        label: direction,
        score: contenderScore,
        confidence: 0.82,
        explanation:
          args.offseason.team_direction_engine.rationale[0] ||
          'Team direction based on starter quality, age curve, draft capital, and roster insulation.',
      },
      competitive_window: {
        label: contenderScore >= 70 ? '1_to_2_year_window' : contenderScore >= 55 ? '2_to_3_year_window' : '3_plus_year_window',
        score: clamp0to100((contenderScore + futureAssetScore) / 2),
      },
    },
    team_snapshot: {
      overall_grade: clamp0to100((contenderScore + futureAssetScore + tradeFlexScore) / 3),
      contender_score: contenderScore,
      rebuild_score: rebuildScore,
      age_curve_score: ageCurveScore,
      starter_strength_score: clamp0to100(args.offseason.team_reality_check.short_term_ceiling),
      bench_depth_score: benchDepthScore,
      future_asset_score: futureAssetScore,
      trade_flexibility_score: tradeFlexScore,
      injury_fragility_score: clamp0to100(40 + decline.length * 8),
      league_market_advantage_score: clamp0to100(52 + tradeTargets.length * 6),
    },
    roster_strengths: strengths.slice(0, 3).map((s, idx) => ({
      area: s,
      score: clamp0to100(84 - idx * 6),
      reason: `${s} is a stable edge relative to league baseline and supports your current window.`,
    })),
    roster_weaknesses: weaknesses.slice(0, 3).map((w, idx) => ({
      area: w,
      score: clamp0to100(48 - idx * 5),
      reason: toNeedReason(w),
    })),
    needs_by_priority: priorities.slice(0, 3).map((need, idx) => ({
      priority: idx + 1,
      need,
      impact_score: clamp0to100(20 - idx * 3),
    })),
    player_watchlists: {
      breakout_candidates: breakout.slice(0, 5).map((name, idx) => ({
        player_id: `nfl_${slugify(name)}`,
        name,
        position: 'UNK',
        breakout_score: clamp0to100(82 - idx * 5),
        reason: 'Role trajectory and market signal imply potential value growth.',
      })),
      decline_candidates: decline.slice(0, 5).map((name, idx) => ({
        player_id: `nfl_${slugify(name)}`,
        name,
        position: 'UNK',
        decline_score: clamp0to100(77 - idx * 4),
        reason: 'Age and fragility risk are rising versus projected return.',
      })),
      hold_candidates: holdCandidates.slice(0, 5).map((name, idx) => ({
        player_id: `nfl_${slugify(name)}`,
        name,
        position: 'UNK',
        hold_score: clamp0to100(74 - idx * 3),
        reason: 'Current market price is lower than internal valuation path.',
      })),
      cut_candidates: cutCandidates.slice(0, 5).map((name, idx) => ({
        player_id: `nfl_${slugify(name)}`,
        name,
        position: 'UNK',
        cut_score: clamp0to100(69 - idx * 3),
        reason: 'Low roster-slot efficiency and weak probability of value appreciation.',
      })),
    },
    market_opportunities: {
      buy_low_targets: tradeTargets.slice(0, 5).map((name, idx) => ({
        player_id: `nfl_${slugify(name)}`,
        name,
        position: 'UNK',
        team_id: `other_team_${idx + 1}`,
        fit_score: clamp0to100(80 - idx * 4),
        estimated_cost_tier: '2nd_plus_player',
        reason: 'Current market signal appears below projected role-adjusted value.',
      })),
      sell_high_targets: sellHigh.slice(0, 5).map((name, idx) => ({
        player_id: `nfl_${slugify(name)}`,
        name,
        position: 'UNK',
        fit_score: clamp0to100(62 - idx * 3),
        estimated_return_tier: 'mid_1st_or_equivalent',
        reason: 'Market pricing is elevated relative to multi-year value trajectory.',
      })),
      waiver_stashes: waiverStashes.slice(0, 5).map((name, idx) => ({
        player_id: `nfl_${slugify(name)}`,
        name,
        position: 'UNK',
        stash_score: clamp0to100(75 - idx * 4),
        reason: 'Low-cost path to role growth and optionality.',
      })),
    },
    action_plan: args.offseason.ai_gm_plan.urgent_tasks.slice(0, 3).map((task, idx) => ({
      order: idx + 1,
      action_type: idx === 0 ? 'trade_target' : idx === 1 ? 'bench_cleanup' : 'draft_strategy',
      title: task,
      details: args.offseason.ai_gm_plan.next_two_weeks[idx] || task,
    })),
    alerts: [
      {
        severity: 'medium',
        type: 'market_shift',
        title: 'Value volatility detected on at least one veteran asset',
        body: 'Review sell-high opportunities before preseason role clarity reduces pricing edge.',
      },
    ],
    coaching_summary: {
      headline:
        args.reportSignal?.title || `You are trending toward ${direction === 'rebuild' ? 'rebuild discipline' : 'a selective retool path'}`,
      summary:
        args.reportSignal?.next_season_advice ||
        args.offseason.team_direction_engine.next_actions[0] ||
        'Use your current roster edge, but preserve flexibility until market windows open.',
    },
  }
}

export function buildDraftWarRoomData(args: {
  offseason: LegacyOffseasonBundle
  draftInput?: DraftWarRoomInput
}): Record<string, unknown> {
  const draft = args.draftInput || {}
  const available = draft.available_players || []
  const likelyTaken = draft.likely_taken_before_pick || []
  const bestFit = args.offseason.draft_war_room.best_fit
  const bestValue = args.offseason.draft_war_room.best_value
  const safest = args.offseason.draft_war_room.safest_pick
  const upside = args.offseason.draft_war_room.upside_pick
  const pickNumber = typeof draft.pick_number === 'number' ? draft.pick_number : 0

  const availabilityMatrix = available.slice(0, 8).map((name, idx) => ({
    player_id: `rookie_${slugify(name)}`,
    name,
    probability_available_at_pick: clamp01(0.72 - idx * 0.08),
  }))

  return {
    screen: 'draft_war_room',
    version: '1.0',
    generated_at: new Date().toISOString(),
    draft_context: {
      league_id: 'unknown_league',
      draft_id: 'unknown_draft',
      round: Math.max(1, Math.ceil(Math.max(1, pickNumber) / 12)),
      pick_number: pickNumber,
      overall_pick: pickNumber,
      user_team_id: 'team_owner',
      draft_type: 'snake',
      player_pool: 'rookie',
      clock_status: pickNumber > 0 ? 'upcoming' : 'unknown',
    },
    team_strategy_context: {
      team_direction: normalizeDirectionLabel(args.offseason.team_direction_engine.label),
      primary_need: args.offseason.team_reality_check.weaknesses[0] || 'RB',
      secondary_need: args.offseason.team_reality_check.weaknesses[1] || 'WR',
      roster_build: 'balanced_superflex',
      risk_profile: 'balanced',
    },
    best_pick_now: {
      player_id: `rookie_${slugify(bestFit)}`,
      name: bestFit,
      position: 'UNK',
      nfl_team: null,
      draft_pick_score: 88.4,
      fit_score: 86.2,
      value_score: 82.1,
      tier: 2,
      recommendation: 'draft_now',
      reason: args.offseason.draft_war_room.recommendation,
    },
    alternate_recommendations: {
      best_fit: { player_id: `rookie_${slugify(bestFit)}`, name: bestFit, score: 88.4 },
      best_value: { player_id: `rookie_${slugify(bestValue)}`, name: bestValue, score: 86.1 },
      highest_upside: { player_id: `rookie_${slugify(upside)}`, name: upside, score: 83.9 },
      safest_pick: { player_id: `rookie_${slugify(safest)}`, name: safest, score: 81.4 },
    },
    players_likely_taken_before_you: likelyTaken.slice(0, 4).map((name, idx) => ({
      pick_before_you: Math.max(1, pickNumber - (likelyTaken.length - idx)),
      team_id: `team_${idx + 1}`,
      team_need: idx % 2 === 0 ? 'RB' : 'QB',
      predicted_pick: {
        player_id: `rookie_${slugify(name)}`,
        name,
        position: 'UNK',
      },
      probability: clamp01(0.44 - idx * 0.06),
      reason: 'Team need, positional run pressure, and recent pick-behavior profile.',
    })),
    availability_matrix: availabilityMatrix,
    pivot_plan: {
      if_top_target_gone: [bestValue, upside].filter(Boolean).map((name, idx) => ({
        priority: idx + 1,
        player_id: `rookie_${slugify(name)}`,
        name,
        reason: idx === 0 ? 'Best remaining value within your current tier range.' : 'Higher variance option with stronger long-term upside.',
      })),
      if_tier_break_happens: {
        recommended_action: 'trade_back',
        target_range: '1.10_to_2.01',
        reason: 'When tier cliffs hit early, moving back preserves expected value and adds flexibility.',
      },
    },
    trade_pick_guidance: {
      should_trade_up: false,
      should_trade_back: true,
      should_hold: true,
      preferred_action: 'hold_unless_tier_break',
      trade_up_threshold: {
        max_future_cost: 'late_2nd_only',
        condition: `only if ${bestFit} is still available 2 picks before your slot`,
      },
      trade_back_targets: [
        {
          target_pick_range: '1.10_to_2.01',
          minimum_return: 'plus_mid_3rd',
          reason: 'Tier compression beyond your current slot supports extracting extra draft capital.',
        },
      ],
    },
    scarcity_signals: {
      position_runs: [
        {
          position: args.offseason.team_reality_check.weaknesses[0] || 'RB',
          run_risk: 0.71,
          reason: 'Multiple teams ahead project as need-based drafters at this position.',
        },
      ],
      tier_pressure: [
        {
          position: args.offseason.team_reality_check.weaknesses[1] || 'WR',
          current_tier_drop_risk: 0.62,
        },
      ],
    },
    season_outlook_if_pick_made: {
      with_best_pick_now: {
        projected_team_grade_after_pick: clamp0to100(args.offseason.team_reality_check.contender_score + 6),
        playoff_odds_change: 0.04,
        future_value_change: 6.8,
      },
    },
    coaching_summary: {
      headline: `Take ${bestFit} if available`,
      summary: args.offseason.draft_war_room.recommendation,
    },
  }
}

export function buildTradeCommandCenterData(args: {
  snapshot: LeagueSnapshot
  offseason: LegacyOffseasonBundle
}): Record<string, unknown> {
  const bestTargets = args.offseason.trade_command_center.best_targets
  const direction = normalizeDirectionLabel(args.offseason.team_direction_engine.label)
  const offer = args.offseason.trade_command_center.offer_builder

  const chips = args.offseason.team_reality_check.strengths.slice(0, 3)
  const untouchables = args.offseason.player_market_board.breakout_watch.slice(0, 2)
  const hold = args.offseason.player_market_board.decline_watch.slice(0, 2)

  const makeAsset = (name: string, idx: number) => ({
    asset_type: 'player',
    asset_id: `nfl_${slugify(name)}`,
    name,
    reason: idx === 0 ? 'Core value profile relative to your competitive window.' : 'Value still expected to appreciate in your current build.',
  })

  return {
    screen: 'trade_command_center',
    version: '1.0',
    generated_at: new Date().toISOString(),
    team_context: {
      league_id: String((args.snapshot.league_history?.[0] as Record<string, unknown> | undefined)?.id || 'unknown_league'),
      user_team_id: 'team_owner',
      team_direction: direction,
      risk_profile: 'balanced',
      trade_aggressiveness: direction === 'contender' ? 'moderate' : 'selective',
    },
    asset_map: {
      untouchables: untouchables.map(makeAsset),
      preferred_trade_chips: chips.map((name, idx) => ({
        asset_type: idx === 0 ? 'player' : 'pick',
        asset_id: idx === 0 ? `nfl_${slugify(name)}` : `2026_rd${idx + 2}_0${idx + 4}`,
        name: idx === 0 ? name : `2026 ${idx + 2}.${idx + 4}`,
        reason: 'Useful outgoing value in the right consolidation package.',
      })),
      hold_until_value_recovers: hold.map(makeAsset),
    },
    recommended_targets: {
      win_now_targets: bestTargets.win_now_targets.slice(0, 4).map((name, idx) => ({
        target_team_id: `team_${idx + 3}`,
        player_id: `nfl_${slugify(name)}`,
        name,
        position: 'UNK',
        fit_score: clamp0to100(84 - idx * 4),
        estimated_price_tier: 'late_1st_plus_depth',
        reason: 'Immediate lineup gain at a current roster pressure point.',
      })),
      retool_targets: bestTargets.rebuild_targets.slice(0, 4).map((name, idx) => ({
        target_team_id: `team_${idx + 5}`,
        player_id: `nfl_${slugify(name)}`,
        name,
        position: 'UNK',
        fit_score: clamp0to100(79 - idx * 3),
        estimated_price_tier: '2nd_plus_player',
        reason: 'Improves medium-term insulation without forcing all-in risk.',
      })),
      buy_low_targets: bestTargets.buy_low_targets.slice(0, 4).map((name, idx) => ({
        target_team_id: `team_${idx + 8}`,
        player_id: `nfl_${slugify(name)}`,
        name,
        position: 'UNK',
        fit_score: clamp0to100(75 - idx * 2),
        estimated_price_tier: 'discounted_1st_equivalent',
        reason: 'Market softened relative to internal projection range.',
      })),
    },
    offer_builder: bestTargets.win_now_targets.slice(0, 2).map((name) => ({
      target_player_id: `nfl_${slugify(name)}`,
      target_name: name,
      offer_templates: {
        fair_offer: {
          send: [{ asset_type: 'pick', asset_id: '2026_rd2_07' }, { asset_type: 'player', asset_id: 'nfl_depth_1' }],
          receive: [{ asset_type: 'player', asset_id: `nfl_${slugify(name)}` }],
          fairness_score: 83.1,
        },
        aggressive_opener: {
          send: [{ asset_type: 'pick', asset_id: '2026_rd3_04' }, { asset_type: 'player', asset_id: 'nfl_depth_2' }],
          receive: [{ asset_type: 'player', asset_id: `nfl_${slugify(name)}` }],
          fairness_score: 64.7,
        },
        fallback_counter: {
          send: [{ asset_type: 'pick', asset_id: '2026_rd2_07' }, { asset_type: 'player', asset_id: 'nfl_depth_2' }],
          receive: [{ asset_type: 'player', asset_id: `nfl_${slugify(name)}` }, { asset_type: 'pick', asset_id: '2027_rd4' }],
          fairness_score: 79.8,
        },
        do_not_exceed: {
          max_offer_rule: offer.do_not_exceed_price,
        },
      },
      why_other_manager_might_accept: [
        'Their current roster has depth pressure at your outbound position.',
        'Your package includes near-term starter usability plus future insulation.',
        'Offer aligns with their current team direction incentives.',
      ],
    })),
    incoming_offers: [],
    sent_offers: [],
    expired_or_rejected_offers: [],
    renegotiation_board: args.offseason.trade_command_center.renegotiation_engine.slice(0, 3).map((reason, idx) => ({
      trade_id: `trade_${9000 + idx}`,
      action: idx === 0 ? 'reopen' : idx === 1 ? 'counter' : 'decline',
      priority: idx + 1,
      reason,
    })),
    market_signals: {
      players_to_move_now: args.offseason.player_market_board.decline_watch.slice(0, 3).map((name) => ({
        player_id: `nfl_${slugify(name)}`,
        name,
        reason: 'Value appears near local peak while trajectory risk is rising.',
      })),
      players_to_target_now: args.offseason.trade_command_center.best_targets.buy_low_targets.slice(0, 3).map((name) => ({
        player_id: `nfl_${slugify(name)}`,
        name,
        reason: 'Live-news volatility likely created a temporary market discount.',
      })),
    },
    coaching_summary: {
      headline: 'Be selective, not passive',
      summary: args.offseason.team_direction_engine.next_actions[0] || 'Target high-leverage upgrades but protect premium future capital.',
    },
  }
}
