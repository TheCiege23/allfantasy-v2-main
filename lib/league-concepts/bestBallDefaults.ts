/**
 * Canonical best-ball league defaults — single source of truth for NFL and NCAAF
 * best-ball creation. Mirrors the dynastyDefaults pattern. Enforces best-ball
 * invariants: waivers/trades/subs disabled, bench=0, IR=0, taxi=0, no keeper
 * carryover, no devy/C2C, NCAAF pool isolation.
 */
import type { LeagueSport } from '@prisma/client'

// ── Types ─────────────────────────────────────────────────────────────────────

export type BestBallEligibleSport = 'NFL' | 'NCAAF'

export const BEST_BALL_CANONICAL_DRAFT_TYPE_IDS = [
  'snake',
  'auction',
  'linear',
  'offline',
  'auto',
] as const

export type BestBallCanonicalDraftType = (typeof BEST_BALL_CANONICAL_DRAFT_TYPE_IDS)[number]

type EngineDraftType = 'snake' | 'linear' | 'auction'
type DraftExecutionMode = 'live' | 'offline' | 'auto'

export interface BestBallRosterTemplate {
  rosterMode: 'best_ball'
  starterSlots: Record<string, number>
  flexDefinitions: Array<{ slotName: string; allowedPositions: string[] }>
  benchSlots: 0
  irSlots: 0
  taxiSlots: 0
  rosterSlots: number
  totalRosterSlots: number
  draftRounds: number
  lineupTemplateId: string
  rosterTemplateId: string
  draftablePlayerPositions: string[]
}

export interface BestBallDraftSettings {
  draftType: EngineDraftType
  requestedDraftType: BestBallCanonicalDraftType
  draftExecutionMode: DraftExecutionMode
  rounds: number
  timerSeconds: number
  slowTimerSeconds: number | null
  pickOrderRules: 'snake' | 'linear'
  snakeOrLinear: 'snake' | 'linear'
  thirdRoundReversal: boolean
  autopickBehavior: 'queue-first'
  autopickBehaviorAlias: 'queue_first'
  queueSizeLimit: number
  preDraftRankingSource: 'adp'
  rosterFillOrder: string
  positionFilterBehavior: string
  auctionBudgetPerTeam: number | null
  offlineEntryTracking: boolean
}

export interface BestBallDefaultContract {
  sport: BestBallEligibleSport
  league_type: 'best_ball'
  leagueType: 'best_ball'
  draft_type: EngineDraftType
  requested_draft_type: BestBallCanonicalDraftType
  teams: number
  rounds: number
  timer_seconds: number
  scoring_preset_id: string
  roster_mode: 'best_ball'
  rosterTemplate: BestBallRosterTemplate
  scoringSettings: Record<string, unknown>
  draftSettings: BestBallDraftSettings
  playerPoolRules: Record<string, unknown>
  tabsEnabled: Record<string, true | 'commissioner'>
  enabledFeatures: Record<string, boolean>
  seasonSettings: Record<string, unknown>
  optimizerSettings: Record<string, unknown>
}

// ── Roster configs ─────────────────────────────────────────────────────────────

const NFL_BEST_BALL_STARTERS = { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2 } as const
const NCAAF_BEST_BALL_STARTERS = { QB: 1, RB: 2, WR: 3, FLEX: 2 } as const

const NFL_BEST_BALL_ROSTER_CONFIG = {
  starterSlots: NFL_BEST_BALL_STARTERS as Record<string, number>,
  rosterSize: 18,
  lineupTemplateId: 'best_ball_nfl_default',
  rosterTemplateId: 'nfl-best_ball',
  draftablePlayerPositions: ['QB', 'RB', 'WR', 'TE', 'K'],
  regularSeasonLength: 14,
  playoffTeams: 6,
}

const NCAAF_BEST_BALL_ROSTER_CONFIG = {
  starterSlots: NCAAF_BEST_BALL_STARTERS as Record<string, number>,
  rosterSize: 16,
  lineupTemplateId: 'best_ball_ncaaf_default',
  rosterTemplateId: 'ncaaf-best_ball',
  draftablePlayerPositions: ['QB', 'RB', 'WR', 'TE', 'K'],
  // 4 teams play weeks 12-13 — NCAAF brackets end on week 13 (ncaafPlayoffWindow.ts).
  regularSeasonLength: 11,
  playoffTeams: 4,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function isBestBallEligibleSport(sport: unknown): sport is BestBallEligibleSport {
  const normalized = String(sport ?? '').trim().toUpperCase()
  return normalized === 'NFL' || normalized === 'NCAAF'
}

function normalizeEngineDraftType(draftType: unknown): EngineDraftType {
  const raw = String(draftType ?? '').trim().toLowerCase()
  if (raw === 'auction') return 'auction'
  if (raw === 'linear') return 'linear'
  return 'snake'
}

function normalizeBestBallDraftType(value: unknown): BestBallCanonicalDraftType {
  const raw = String(value ?? '').trim().toLowerCase()
  return (BEST_BALL_CANONICAL_DRAFT_TYPE_IDS as readonly string[]).includes(raw)
    ? (raw as BestBallCanonicalDraftType)
    : 'snake'
}

function pickOrderForDraftType(draftType: BestBallCanonicalDraftType): 'snake' | 'linear' {
  return normalizeEngineDraftType(draftType) === 'linear' ? 'linear' : 'snake'
}

function executionModeForDraftType(draftType: BestBallCanonicalDraftType): DraftExecutionMode {
  if (draftType === 'offline') return 'offline'
  if (draftType === 'auto') return 'auto'
  return 'live'
}

function starterCount(slots: Record<string, number>): number {
  return Object.values(slots).reduce((total, n) => total + n, 0)
}

function defaultScoringPresetId(sport: BestBallEligibleSport): string {
  return sport === 'NCAAF' ? 'ncaaf_half_ppr' : 'fb_ppr'
}

// ── Builders ──────────────────────────────────────────────────────────────────

function buildRosterTemplate(sport: BestBallEligibleSport): BestBallRosterTemplate {
  const cfg = sport === 'NCAAF' ? NCAAF_BEST_BALL_ROSTER_CONFIG : NFL_BEST_BALL_ROSTER_CONFIG
  const rosterSlots = starterCount(cfg.starterSlots)
  return {
    rosterMode: 'best_ball',
    starterSlots: cfg.starterSlots,
    flexDefinitions: [{ slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'] }],
    benchSlots: 0,
    irSlots: 0,
    taxiSlots: 0,
    rosterSlots,
    totalRosterSlots: cfg.rosterSize,
    draftRounds: cfg.rosterSize,
    lineupTemplateId: cfg.lineupTemplateId,
    rosterTemplateId: cfg.rosterTemplateId,
    draftablePlayerPositions: cfg.draftablePlayerPositions,
  }
}

function buildScoringSettings(
  sport: BestBallEligibleSport,
  scoringPresetId: string,
): Record<string, unknown> {
  const id = scoringPresetId.toLowerCase()
  const ppr = id.includes('standard') || id.endsWith('_std') ? 0 : id.includes('half') ? 0.5 : 1
  const format = ppr === 0 ? 'standard' : ppr === 1 ? 'ppr' : 'half_ppr'
  const scoringFormat = sport === 'NCAAF' ? `${format}_college` : format
  const templateId =
    sport === 'NCAAF'
      ? format === 'standard'
        ? 'default-NCAAF-standard'
        : format === 'ppr'
          ? 'default-NCAAF-PPR'
          : 'default-NCAAF-HALF_PPR'
      : format === 'standard'
        ? 'default-NFL-standard'
        : format === 'ppr'
          ? 'default-NFL-PPR'
          : 'default-NFL-HALF_PPR'

  return {
    source: 'af',
    sport,
    preset: scoringPresetId,
    scoringPresetId,
    scoringTemplateId: templateId,
    scoringMode: 'points',
    scoringFormat,
    format,
    ppr,
    superflex: false,
    tePremium: false,
    tePremiumMultiplier: 1,
    idp: false,
    bestBall: true,
    rules: {
      ppr,
      passingTouchdown: 4,
      receivingTouchdown: 6,
      rushingTouchdown: 6,
      fieldGoalMade: 3,
    },
  }
}

function buildDraftSettings(
  sport: BestBallEligibleSport,
  draftType: BestBallCanonicalDraftType,
  rosterTemplate: BestBallRosterTemplate,
): BestBallDraftSettings {
  const engineDraftType = normalizeEngineDraftType(draftType)
  const pickOrderRules = pickOrderForDraftType(draftType)
  const executionMode = executionModeForDraftType(draftType)
  const isSnake = engineDraftType === 'snake'
  const thirdRoundReversal = isSnake && sport === 'NFL'
  return {
    draftType: engineDraftType,
    requestedDraftType: draftType,
    draftExecutionMode: executionMode,
    rounds: rosterTemplate.draftRounds,
    timerSeconds: 90,
    slowTimerSeconds: null,
    pickOrderRules,
    snakeOrLinear: pickOrderRules,
    thirdRoundReversal,
    autopickBehavior: 'queue-first',
    autopickBehaviorAlias: 'queue_first',
    queueSizeLimit: 50,
    preDraftRankingSource: 'adp',
    rosterFillOrder: 'starter_first',
    positionFilterBehavior: 'by_eligibility',
    auctionBudgetPerTeam: engineDraftType === 'auction' ? 200 : null,
    offlineEntryTracking: draftType === 'offline',
  }
}

function buildPlayerPoolRules(
  sport: BestBallEligibleSport,
  rosterTemplate: BestBallRosterTemplate,
): Record<string, unknown> {
  const positions = rosterTemplate.draftablePlayerPositions
  if (sport === 'NCAAF') {
    return {
      sport: 'NCAAF',
      poolKey: 'ncaaf_active_college_fantasy_players',
      source: 'sports_player',
      includeActiveOnly: true,
      includeCollegePlayers: true,
      includeNflPlayers: false,
      collegeOnly: true,
      rookieOnly: false,
      excludeNflPool: true,
      positions,
      rankingSource: 'adp',
    }
  }
  return {
    sport: 'NFL',
    poolKey: 'nfl_active_fantasy_players',
    source: 'sports_player',
    includeActiveOnly: true,
    includeCollegePlayers: false,
    includeNflPlayers: true,
    collegeOnly: false,
    rookieOnly: false,
    positions,
    rankingSource: 'adp',
  }
}

function buildSeasonSettings(sport: BestBallEligibleSport): Record<string, unknown> {
  const cfg = sport === 'NCAAF' ? NCAAF_BEST_BALL_ROSTER_CONFIG : NFL_BEST_BALL_ROSTER_CONFIG
  return {
    scoringPeriod: 'weekly',
    regularSeasonLength: cfg.regularSeasonLength,
    playoffTeams: cfg.playoffTeams,
    playoffFormat: 'bracket',
    matchupFormat: 'h2h',
    tieRule: 'max_week',
    waiversEnabled: false,
    tradesEnabled: false,
    substitutionsEnabled: false,
    cumulativeScoring: false,
    contestStructure: 'season_long',
  }
}

function buildTabsEnabled(): Record<string, true | 'commissioner'> {
  return {
    overview: true,
    teams: true,
    roster: true,
    standings: true,
    matchups: true,
    draft: true,
    live_draft: true,
    settings: 'commissioner',
  }
}

function buildEnabledFeatures(): Record<string, boolean> {
  return {
    waivers: false,
    waivers_enabled: false,
    trades: false,
    trades_enabled: false,
    substitutions: false,
    substitutions_enabled: false,
    taxi: false,
    taxi_enabled: false,
    future_picks: false,
    future_picks_enabled: false,
    keeper_carryover: false,
    keeper_dynasty_carryover_supported: false,
    devy: false,
    devy_enabled: false,
    c2c: false,
    c2c_enabled: false,
    contracts: false,
    salary_cap: false,
    salary_cap_enabled: false,
    isBestBall: true,
    isDynasty: false,
    isRedraft: false,
    isKeeper: false,
    best_ball_optimizer: true,
  }
}

function buildOptimizerSettings(
  sport: BestBallEligibleSport,
  rosterTemplate: BestBallRosterTemplate,
): Record<string, unknown> {
  return {
    enabled: true,
    lineupTemplateId: rosterTemplate.lineupTemplateId,
    autoSetBestLineup: true,
    optimizerMode: 'best_ball',
    sport,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getBestBallDefaultContract(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): BestBallDefaultContract | null {
  const normalizedSport = String(input.sport ?? '').trim().toUpperCase()
  if (!isBestBallEligibleSport(normalizedSport)) return null

  const sport = normalizedSport
  const requestedDraftType = normalizeBestBallDraftType(input.draftType)
  const rosterTemplate = buildRosterTemplate(sport)
  const draftSettings = buildDraftSettings(sport, requestedDraftType, rosterTemplate)
  const scoringPresetId =
    typeof input.scoringPresetId === 'string' && input.scoringPresetId.trim()
      ? input.scoringPresetId.trim()
      : defaultScoringPresetId(sport)
  const scoringSettings = buildScoringSettings(sport, scoringPresetId)
  const playerPoolRules = buildPlayerPoolRules(sport, rosterTemplate)
  const seasonSettings = buildSeasonSettings(sport)
  const tabsEnabled = buildTabsEnabled()
  const enabledFeatures = buildEnabledFeatures()
  const optimizerSettings = buildOptimizerSettings(sport, rosterTemplate)
  const teamCount = typeof input.teamCount === 'number' && input.teamCount > 0 ? Math.floor(input.teamCount) : 12

  return {
    sport,
    league_type: 'best_ball',
    leagueType: 'best_ball',
    draft_type: draftSettings.draftType,
    requested_draft_type: requestedDraftType,
    teams: teamCount,
    rounds: draftSettings.rounds,
    timer_seconds: draftSettings.timerSeconds,
    scoring_preset_id: scoringPresetId,
    roster_mode: 'best_ball',
    rosterTemplate,
    scoringSettings,
    draftSettings,
    playerPoolRules,
    tabsEnabled,
    enabledFeatures,
    seasonSettings,
    optimizerSettings,
  }
}

export function buildBestBallSettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): Record<string, unknown> | null {
  const contract = getBestBallDefaultContract(input)
  if (!contract) return null

  const { draftSettings, rosterTemplate } = contract
  return {
    bestBallDefaultsVersion: 1,
    sport: contract.sport,
    sport_type: contract.sport,
    leagueType: 'best_ball',
    league_type: 'best_ball',
    roster_mode: 'best_ball',
    isBestBall: true,
    teams: contract.teams,
    default_team_count: contract.teams,
    scoring_preset_id: contract.scoring_preset_id,
    scoringPreset: contract.scoring_preset_id,
    scoring_mode: 'points',
    scoring_format: contract.scoringSettings.scoringFormat,
    scoring_template_id: contract.scoringSettings.scoringTemplateId,
    draft_type: draftSettings.draftType,
    requested_draft_type: draftSettings.requestedDraftType,
    draft_execution_mode: draftSettings.draftExecutionMode,
    draft_rounds: draftSettings.rounds,
    draft_timer_seconds: draftSettings.timerSeconds,
    draft_pick_order_rules: draftSettings.pickOrderRules,
    draft_snake_or_linear: draftSettings.snakeOrLinear,
    draft_third_round_reversal: draftSettings.thirdRoundReversal,
    draft_autopick_behavior: draftSettings.autopickBehavior,
    draft_autopick_behavior_alias: draftSettings.autopickBehaviorAlias,
    draft_queue_size_limit: draftSettings.queueSizeLimit,
    queue_size_limit: draftSettings.queueSizeLimit,
    draft_pre_draft_ranking_source: draftSettings.preDraftRankingSource,
    draft_roster_fill_order: draftSettings.rosterFillOrder,
    draft_position_filter_behavior: draftSettings.positionFilterBehavior,
    draft_order: draftSettings.pickOrderRules,
    third_round_reversal: draftSettings.thirdRoundReversal,
    rounds: draftSettings.rounds,
    timer_seconds: draftSettings.timerSeconds,
    roster_size: rosterTemplate.totalRosterSlots,
    rosterSize: rosterTemplate.totalRosterSlots,
    starter_slots: rosterTemplate.starterSlots,
    bench_slots: 0,
    ir_slots: 0,
    taxi_slots: 0,
    rosterTemplate,
    rosterSettings: {
      rosterMode: 'best_ball',
      starterSlots: rosterTemplate.starterSlots,
      flexDefinitions: rosterTemplate.flexDefinitions,
      benchSlots: 0,
      irSlots: 0,
      taxiSlots: 0,
      rosterSlots: rosterTemplate.rosterSlots,
      rosterSize: rosterTemplate.totalRosterSlots,
      draftRounds: rosterTemplate.draftRounds,
      lineupTemplateId: rosterTemplate.lineupTemplateId,
      rosterTemplateId: rosterTemplate.rosterTemplateId,
      draftablePlayerPositions: rosterTemplate.draftablePlayerPositions,
    },
    scoringSettings: contract.scoringSettings,
    draftSettings,
    seasonSettings: contract.seasonSettings,
    playerPoolRules: contract.playerPoolRules,
    player_pool_rules: contract.playerPoolRules,
    player_pool: contract.playerPoolRules.poolKey,
    tabsEnabled: contract.tabsEnabled,
    tabs_enabled: contract.tabsEnabled,
    optimizerSettings: contract.optimizerSettings,
    ...contract.enabledFeatures,
    // Explicit guardrails
    devyConfig: { enabled: false },
    c2cConfig: { enabled: false },
    keeperSettings: { enabled: false },
    salaryCapSettings: { enabled: false },
    contractSettings: { enabled: false },
    rookieDraftConfig: { enabled: false },
    futurePicksConfig: { enabled: false },
  }
}

export function normalizeBestBallSettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
  settings?: Record<string, unknown> | null
}): Record<string, unknown> {
  const incoming = input.settings ?? {}
  const requestedDraftType = normalizeBestBallDraftType(
    input.draftType ?? incoming.requested_draft_type ?? incoming.draft_type,
  )
  const scoringPresetId =
    typeof incoming.scoring_preset_id === 'string'
      ? incoming.scoring_preset_id
      : typeof incoming.scoringPreset === 'string'
        ? incoming.scoringPreset
        : input.scoringPresetId
  const teamCount =
    typeof incoming.default_team_count === 'number'
      ? incoming.default_team_count
      : typeof incoming.teams === 'number'
        ? incoming.teams
        : input.teamCount
  const defaults =
    buildBestBallSettingsSnapshot({
      sport: input.sport,
      draftType: requestedDraftType,
      scoringPresetId,
      teamCount,
    }) ?? {}

  const merged: Record<string, unknown> = { ...defaults, ...incoming }

  // Re-apply canonical draft settings — incoming snapshot may have been built with a
  // different draft type (e.g. catalog uses draftTypesAllowed[0]='snake' but user requested 'auction')
  merged.draftSettings = defaults.draftSettings
  merged.draft_type = defaults.draft_type
  merged.requested_draft_type = defaults.requested_draft_type
  merged.draft_execution_mode = defaults.draft_execution_mode
  merged.draft_rounds = defaults.draft_rounds
  merged.draft_pick_order_rules = defaults.draft_pick_order_rules
  merged.draft_snake_or_linear = defaults.draft_snake_or_linear
  merged.draft_third_round_reversal = defaults.draft_third_round_reversal
  merged.third_round_reversal = defaults.third_round_reversal
  merged.rounds = defaults.rounds

  // Enforce best-ball invariants — cannot be overridden by user
  merged.league_type = 'best_ball'
  merged.leagueType = 'best_ball'
  merged.roster_mode = 'best_ball'
  merged.isBestBall = true
  merged.isDynasty = false
  merged.isRedraft = false
  merged.isKeeper = false

  // Hard guardrails — best ball never has these enabled
  merged.waivers = false
  merged.waivers_enabled = false
  merged.trades = false
  merged.trades_enabled = false
  merged.substitutions = false
  merged.substitutions_enabled = false
  merged.taxi = false
  merged.taxi_enabled = false
  merged.taxi_slots = 0
  merged.future_picks = false
  merged.future_picks_enabled = false
  merged.keeper_carryover = false
  merged.keeper_dynasty_carryover_supported = false
  merged.keeperDynastyCarryoverSupported = false
  merged.devy = false
  merged.devy_enabled = false
  merged.c2c = false
  merged.c2c_enabled = false
  merged.devyConfig = { ...(typeof incoming.devyConfig === 'object' && incoming.devyConfig !== null ? incoming.devyConfig as object : {}), enabled: false }
  merged.c2cConfig = { ...(typeof incoming.c2cConfig === 'object' && incoming.c2cConfig !== null ? incoming.c2cConfig as object : {}), enabled: false }
  merged.keeperSettings = { ...(typeof incoming.keeperSettings === 'object' && incoming.keeperSettings !== null ? incoming.keeperSettings as object : {}), enabled: false }

  // Enforce roster guardrails — bench/IR/taxi always 0
  merged.bench_slots = 0
  merged.ir_slots = 0

  // Preserve user-supplied league name / language / timezone
  if (typeof incoming.leagueName === 'string') merged.leagueName = incoming.leagueName
  if (typeof incoming.language === 'string') merged.language = incoming.language
  if (typeof incoming.timezone === 'string') merged.timezone = incoming.timezone

  return merged
}
