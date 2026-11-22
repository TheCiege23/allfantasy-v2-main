/**
 * Canonical guillotine league defaults — single source of truth for NFL and NCAAF
 * guillotine creation. Mirrors the redraft/dynasty/bestBall pattern. Enforces
 * guillotine invariants: elimination settings, FAAB waivers, no playoffs, no
 * dynasty/taxi/keeper/devy/C2C, sport-specific player pool isolation.
 *
 * Key rule: defaultTeamCount = regularSeasonWeeks - 1 (one elimination per week,
 * last team standing wins). NFL = 17 teams, NCAAF = 13 teams.
 */
import type { LeagueSport } from '@prisma/client'
import {
  DEFAULT_TIEBREAKER_ORDER,
  DEFAULT_STAT_CORRECTION_HOURS,
  DEFAULT_DANGER_MARGIN_POINTS,
} from '@/lib/guillotine/constants'
import type { TiebreakStep } from '@/lib/guillotine/types'

// ── Types ─────────────────────────────────────────────────────────────────────

type GuillotineEligibleSport = 'NFL' | 'NCAAF'

export const GUILLOTINE_DRAFT_TYPE_IDS = ['snake', 'linear', 'auction'] as const

type GuillotineDraftType = (typeof GUILLOTINE_DRAFT_TYPE_IDS)[number]

type EngineDraftType = 'snake' | 'linear' | 'auction'

interface GuillotineRosterTemplate {
  rosterMode: 'guillotine'
  starterSlots: Record<string, number>
  flexDefinitions: Array<{ slotName: string; allowedPositions: string[] }>
  benchSlots: number
  irSlots: 0
  taxiSlots: 0
  rosterSlots: number
  totalRosterSlots: number
  draftRounds: number
  draftablePlayerPositions: string[]
  defensePosition: 'DST' | 'DEF'
}

interface GuillotineDraftSettings {
  draftType: EngineDraftType
  requestedDraftType: GuillotineDraftType
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
}

interface GuillotineEliminationSettings {
  eliminationsPerPeriod: 1
  eliminationPeriod: 'weekly'
  eliminationStartWeek: number
  eliminationEndWeek: number
  protectedWeek1: boolean
  correctionWindow: 'after_stat_corrections'
  statCorrectionHours: number
  endgame: 'last_team_standing'
  eliminatedRosterRelease: 'next_waiver_run'
  commissionerOverride: true
  tiebreakerOrder: TiebreakStep[]
  dangerMarginPoints: number
}

interface GuillotineWaiverSettings {
  waiverType: 'faab'
  faabEnabled: true
  faabBudgetPerTeam: number
  faabResetRule: 'never'
  waiverProcessingDays: number[]
  waiverProcessingHourUtc: number
  samePeriodPickups: false
  claimPriorityBehavior: 'faab_highest'
  dropLockBehavior: 'lock_with_game'
  continuousWaiversBehavior: false
}

interface GuillotineDefaultContract {
  sport: GuillotineEligibleSport
  league_type: 'guillotine'
  leagueType: 'guillotine'
  draft_type: EngineDraftType
  requested_draft_type: GuillotineDraftType
  teams: number
  rounds: number
  timer_seconds: number
  scoring_preset_id: string
  roster_mode: 'guillotine'
  rosterTemplate: GuillotineRosterTemplate
  scoringSettings: Record<string, unknown>
  draftSettings: GuillotineDraftSettings
  eliminationSettings: GuillotineEliminationSettings
  waiverSettings: GuillotineWaiverSettings
  playerPoolRules: Record<string, unknown>
  tabsEnabled: Record<string, true | 'commissioner'>
  enabledFeatures: Record<string, boolean>
  seasonSettings: Record<string, unknown>
}

// ── Roster configs ─────────────────────────────────────────────────────────────
// Guillotine uses redraft-style rosters; bench is slightly smaller to increase
// waiver chaos and player availability after eliminations.

// NFL: 9 starters (QB:1 RB:2 WR:2 TE:1 FLEX:1 K:1 DST:1), bench:6 → rosterSize:15
const NFL_GUILLOTINE_STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 } as const

const NFL_GUILLOTINE_ROSTER_CONFIG = {
  starterSlots: NFL_GUILLOTINE_STARTERS as Record<string, number>,
  benchSlots: 6,
  rosterSize: 15,
  defensePosition: 'DST' as const,
  draftablePlayerPositions: ['QB', 'RB', 'WR', 'TE', 'K', 'DST'],
  // NFL: 18-week regular season → 17 teams (one eliminated per week)
  defaultTeamCount: 17,
  regularSeasonWeeks: 18,
  eliminationEndWeek: 18,
  waiverProcessingDays: [3], // Wednesday
  waiverProcessingHourUtc: 12,
  queueSizeLimit: 60,
  ncaafOnly: false,
}

// NCAAF: 9 starters (QB:1 RB:2 WR:2 TE:1 FLEX:1 K:1 DEF:1), bench:5 → rosterSize:14
const NCAAF_GUILLOTINE_STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 } as const

const NCAAF_GUILLOTINE_ROSTER_CONFIG = {
  starterSlots: NCAAF_GUILLOTINE_STARTERS as Record<string, number>,
  benchSlots: 5,
  rosterSize: 14,
  defensePosition: 'DEF' as const,
  draftablePlayerPositions: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'],
  // NCAAF: 14-week regular season → 13 teams
  defaultTeamCount: 13,
  regularSeasonWeeks: 14,
  eliminationEndWeek: 14,
  waiverProcessingDays: [1], // Monday
  waiverProcessingHourUtc: 12,
  queueSizeLimit: 70,
  ncaafOnly: true,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function isGuillotineEligibleSport(sport: unknown): sport is GuillotineEligibleSport {
  const normalized = String(sport ?? '').trim().toUpperCase()
  return normalized === 'NFL' || normalized === 'NCAAF'
}

function normalizeEngineDraftType(draftType: unknown): EngineDraftType {
  const raw = String(draftType ?? '').trim().toLowerCase()
  if (raw === 'auction') return 'auction'
  if (raw === 'linear') return 'linear'
  return 'snake'
}

function normalizeGuillotineDraftType(value: unknown): GuillotineDraftType {
  const raw = String(value ?? '').trim().toLowerCase()
  return (GUILLOTINE_DRAFT_TYPE_IDS as readonly string[]).includes(raw)
    ? (raw as GuillotineDraftType)
    : 'snake'
}

function pickOrderForDraftType(dt: GuillotineDraftType): 'snake' | 'linear' {
  return normalizeEngineDraftType(dt) === 'linear' ? 'linear' : 'snake'
}

function starterCount(slots: Record<string, number>): number {
  return Object.values(slots).reduce((t, n) => t + n, 0)
}

function defaultScoringPresetId(sport: GuillotineEligibleSport): string {
  return sport === 'NCAAF' ? 'ncaaf_half_ppr' : 'fb_half_ppr'
}

function rosterConfig(sport: GuillotineEligibleSport) {
  return sport === 'NCAAF' ? NCAAF_GUILLOTINE_ROSTER_CONFIG : NFL_GUILLOTINE_ROSTER_CONFIG
}

// ── Builders ──────────────────────────────────────────────────────────────────

function buildRosterTemplate(sport: GuillotineEligibleSport): GuillotineRosterTemplate {
  const cfg = rosterConfig(sport)
  const starters = starterCount(cfg.starterSlots)
  return {
    rosterMode: 'guillotine',
    starterSlots: cfg.starterSlots,
    flexDefinitions: [{ slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'] }],
    benchSlots: cfg.benchSlots,
    irSlots: 0,
    taxiSlots: 0,
    rosterSlots: starters,
    totalRosterSlots: cfg.rosterSize,
    draftRounds: cfg.rosterSize,
    draftablePlayerPositions: cfg.draftablePlayerPositions,
    defensePosition: cfg.defensePosition,
  }
}

function buildScoringSettings(
  sport: GuillotineEligibleSport,
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
    guillotine: true,
    rules: {
      ppr,
      passingTouchdown: 4,
      receivingTouchdown: 6,
      rushingTouchdown: 6,
      fieldGoalMade: 3,
      teamDefenseTouchdown: 6,
    },
  }
}

function buildDraftSettings(
  sport: GuillotineEligibleSport,
  draftType: GuillotineDraftType,
  rosterTemplate: GuillotineRosterTemplate,
): GuillotineDraftSettings {
  const cfg = rosterConfig(sport)
  const engineDraftType = normalizeEngineDraftType(draftType)
  const pickOrderRules = pickOrderForDraftType(draftType)
  return {
    draftType: engineDraftType,
    requestedDraftType: draftType,
    rounds: rosterTemplate.draftRounds,
    timerSeconds: 90,
    slowTimerSeconds: null,
    pickOrderRules,
    snakeOrLinear: pickOrderRules,
    thirdRoundReversal: false, // Guillotine never uses 3RR — chaos enough already
    autopickBehavior: 'queue-first',
    autopickBehaviorAlias: 'queue_first',
    queueSizeLimit: cfg.queueSizeLimit,
    preDraftRankingSource: 'adp',
    rosterFillOrder: 'starter_first',
    positionFilterBehavior: 'by_eligibility',
    auctionBudgetPerTeam: engineDraftType === 'auction' ? 200 : null,
  }
}

function buildEliminationSettings(sport: GuillotineEligibleSport): GuillotineEliminationSettings {
  const cfg = rosterConfig(sport)
  return {
    eliminationsPerPeriod: 1,
    eliminationPeriod: 'weekly',
    eliminationStartWeek: 1,
    eliminationEndWeek: cfg.eliminationEndWeek,
    protectedWeek1: false,
    correctionWindow: 'after_stat_corrections',
    statCorrectionHours: DEFAULT_STAT_CORRECTION_HOURS,
    endgame: 'last_team_standing',
    eliminatedRosterRelease: 'next_waiver_run',
    commissionerOverride: true,
    tiebreakerOrder: [...DEFAULT_TIEBREAKER_ORDER] as TiebreakStep[],
    dangerMarginPoints: DEFAULT_DANGER_MARGIN_POINTS,
  }
}

function buildWaiverSettings(sport: GuillotineEligibleSport): GuillotineWaiverSettings {
  const cfg = rosterConfig(sport)
  return {
    waiverType: 'faab',
    faabEnabled: true,
    faabBudgetPerTeam: 100,
    faabResetRule: 'never',
    waiverProcessingDays: cfg.waiverProcessingDays,
    waiverProcessingHourUtc: cfg.waiverProcessingHourUtc,
    samePeriodPickups: false,
    claimPriorityBehavior: 'faab_highest',
    dropLockBehavior: 'lock_with_game',
    continuousWaiversBehavior: false,
  }
}

function buildPlayerPoolRules(
  sport: GuillotineEligibleSport,
  rosterTemplate: GuillotineRosterTemplate,
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
      positionAliases: { DEF: ['DST'] },
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
    positionAliases: { DST: ['DEF'] },
    rankingSource: 'adp',
  }
}

function buildSeasonSettings(sport: GuillotineEligibleSport): Record<string, unknown> {
  const cfg = rosterConfig(sport)
  return {
    scoringPeriod: 'weekly',
    regularSeasonLength: cfg.regularSeasonWeeks,
    hasPlayoffs: false,
    playoffTeams: 0,
    matchupFormat: 'h2h',
    // No trades by default — keeps elimination stakes high and prevents collusion
    tradesEnabled: false,
    tradeDeadlineWeek: null,
    tradeReviewMode: 'none',
    waiverEnabled: true,
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
    mock_draft: true,
    waivers: true,
    guillotine_standings: true,
    elimination_history: true,
    settings: 'commissioner',
    commissioner_tools: 'commissioner',
  }
}

function buildEnabledFeatures(): Record<string, boolean> {
  return {
    eliminations: true,
    eliminations_enabled: true,
    elimination_board: true,
    danger_alerts: true,
    guillotine_standings: true,
    waivers: true,
    waivers_enabled: true,
    faab: true,
    faab_enabled: true,
    trades: false,
    trades_enabled: false,
    substitutions: true,
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
    isGuillotine: true,
    isDynasty: false,
    isRedraft: false,
    isKeeper: false,
    isBestBall: false,
    commissioner_override: true,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getGuillotineDefaultContract(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): GuillotineDefaultContract | null {
  const normalizedSport = String(input.sport ?? '').trim().toUpperCase()
  if (!isGuillotineEligibleSport(normalizedSport)) return null

  const sport = normalizedSport
  const requestedDraftType = normalizeGuillotineDraftType(input.draftType)
  const rosterTemplate = buildRosterTemplate(sport)
  const draftSettings = buildDraftSettings(sport, requestedDraftType, rosterTemplate)
  const scoringPresetId =
    typeof input.scoringPresetId === 'string' && input.scoringPresetId.trim()
      ? input.scoringPresetId.trim()
      : defaultScoringPresetId(sport)
  const scoringSettings = buildScoringSettings(sport, scoringPresetId)
  const eliminationSettings = buildEliminationSettings(sport)
  const waiverSettings = buildWaiverSettings(sport)
  const playerPoolRules = buildPlayerPoolRules(sport, rosterTemplate)
  const seasonSettings = buildSeasonSettings(sport)
  const tabsEnabled = buildTabsEnabled()
  const enabledFeatures = buildEnabledFeatures()
  const cfg = rosterConfig(sport)
  const teamCount =
    typeof input.teamCount === 'number' && input.teamCount > 0
      ? Math.floor(input.teamCount)
      : cfg.defaultTeamCount

  return {
    sport,
    league_type: 'guillotine',
    leagueType: 'guillotine',
    draft_type: draftSettings.draftType,
    requested_draft_type: requestedDraftType,
    teams: teamCount,
    rounds: draftSettings.rounds,
    timer_seconds: draftSettings.timerSeconds,
    scoring_preset_id: scoringPresetId,
    roster_mode: 'guillotine',
    rosterTemplate,
    scoringSettings,
    draftSettings,
    eliminationSettings,
    waiverSettings,
    playerPoolRules,
    tabsEnabled,
    enabledFeatures,
    seasonSettings,
  }
}

export function buildGuillotineSettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): Record<string, unknown> | null {
  const contract = getGuillotineDefaultContract(input)
  if (!contract) return null

  const { draftSettings, rosterTemplate, eliminationSettings, waiverSettings } = contract
  return {
    guillotineDefaultsVersion: 1,
    sport: contract.sport,
    sport_type: contract.sport,
    leagueType: 'guillotine',
    league_type: 'guillotine',
    roster_mode: 'guillotine',
    isGuillotine: true,
    teams: contract.teams,
    default_team_count: contract.teams,
    scoring_preset_id: contract.scoring_preset_id,
    scoringPreset: contract.scoring_preset_id,
    scoring_mode: 'points',
    scoring_format: contract.scoringSettings.scoringFormat,
    scoring_template_id: contract.scoringSettings.scoringTemplateId,
    draft_type: draftSettings.draftType,
    requested_draft_type: draftSettings.requestedDraftType,
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
    third_round_reversal: false,
    rounds: draftSettings.rounds,
    timer_seconds: draftSettings.timerSeconds,
    roster_size: rosterTemplate.totalRosterSlots,
    rosterSize: rosterTemplate.totalRosterSlots,
    starter_slots: rosterTemplate.starterSlots,
    bench_slots: rosterTemplate.benchSlots,
    ir_slots: 0,
    taxi_slots: 0,
    rosterTemplate,
    rosterSettings: {
      rosterMode: 'guillotine',
      starterSlots: rosterTemplate.starterSlots,
      flexDefinitions: rosterTemplate.flexDefinitions,
      benchSlots: rosterTemplate.benchSlots,
      irSlots: 0,
      taxiSlots: 0,
      rosterSlots: rosterTemplate.rosterSlots,
      rosterSize: rosterTemplate.totalRosterSlots,
      draftRounds: rosterTemplate.draftRounds,
      draftablePlayerPositions: rosterTemplate.draftablePlayerPositions,
      defensePosition: rosterTemplate.defensePosition,
    },
    scoringSettings: contract.scoringSettings,
    draftSettings,
    eliminationSettings,
    elimination_settings: eliminationSettings,
    eliminations_per_period: eliminationSettings.eliminationsPerPeriod,
    elimination_start_week: eliminationSettings.eliminationStartWeek,
    elimination_end_week: eliminationSettings.eliminationEndWeek,
    protected_week_1: eliminationSettings.protectedWeek1,
    correction_window: eliminationSettings.correctionWindow,
    stat_correction_hours: eliminationSettings.statCorrectionHours,
    endgame: eliminationSettings.endgame,
    eliminated_roster_release: eliminationSettings.eliminatedRosterRelease,
    commissioner_override: eliminationSettings.commissionerOverride,
    tiebreaker_order: eliminationSettings.tiebreakerOrder,
    danger_margin_points: eliminationSettings.dangerMarginPoints,
    waiverSettings,
    waiver_settings: waiverSettings,
    waiver_type: waiverSettings.waiverType,
    faab_enabled: waiverSettings.faabEnabled,
    faab_budget_per_team: waiverSettings.faabBudgetPerTeam,
    faab_reset_rule: waiverSettings.faabResetRule,
    same_period_pickups: waiverSettings.samePeriodPickups,
    claim_priority_behavior: waiverSettings.claimPriorityBehavior,
    seasonSettings: contract.seasonSettings,
    playerPoolRules: contract.playerPoolRules,
    player_pool_rules: contract.playerPoolRules,
    player_pool: contract.playerPoolRules.poolKey,
    tabsEnabled: contract.tabsEnabled,
    tabs_enabled: contract.tabsEnabled,
    ...contract.enabledFeatures,
    // Guardrails
    devyConfig: { enabled: false },
    c2cConfig: { enabled: false },
    keeperSettings: { enabled: false },
    salaryCapSettings: { enabled: false },
    contractSettings: { enabled: false },
    rookieDraftConfig: { enabled: false },
    futurePicksConfig: { enabled: false },
  }
}

export function normalizeGuillotineSettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
  settings?: Record<string, unknown> | null
}): Record<string, unknown> {
  const incoming = input.settings ?? {}
  const requestedDraftType = normalizeGuillotineDraftType(
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
    buildGuillotineSettingsSnapshot({
      sport: input.sport,
      draftType: requestedDraftType,
      scoringPresetId,
      teamCount,
    }) ?? {}

  const merged: Record<string, unknown> = { ...defaults, ...incoming }

  // Re-apply canonical draft settings — prevent stale snapshot draft type from clobbering
  merged.draftSettings = defaults.draftSettings
  merged.draft_type = defaults.draft_type
  merged.requested_draft_type = defaults.requested_draft_type
  merged.draft_rounds = defaults.draft_rounds
  merged.draft_pick_order_rules = defaults.draft_pick_order_rules
  merged.draft_snake_or_linear = defaults.draft_snake_or_linear
  merged.rounds = defaults.rounds

  // Enforce guillotine invariants
  merged.league_type = 'guillotine'
  merged.leagueType = 'guillotine'
  merged.roster_mode = 'guillotine'
  merged.isGuillotine = true
  merged.isDynasty = false
  merged.isRedraft = false
  merged.isKeeper = false
  merged.isBestBall = false

  // Hard guardrails — guillotine never has these
  merged.taxi = false
  merged.taxi_enabled = false
  merged.taxi_slots = 0
  merged.ir_slots = 0
  merged.future_picks = false
  merged.future_picks_enabled = false
  merged.keeper_carryover = false
  merged.keeper_dynasty_carryover_supported = false
  merged.keeperDynastyCarryoverSupported = false
  merged.devy = false
  merged.devy_enabled = false
  merged.c2c = false
  merged.c2c_enabled = false
  merged.devyConfig = {
    ...(typeof incoming.devyConfig === 'object' && incoming.devyConfig !== null ? incoming.devyConfig as object : {}),
    enabled: false,
  }
  merged.c2cConfig = {
    ...(typeof incoming.c2cConfig === 'object' && incoming.c2cConfig !== null ? incoming.c2cConfig as object : {}),
    enabled: false,
  }
  merged.keeperSettings = {
    ...(typeof incoming.keeperSettings === 'object' && incoming.keeperSettings !== null ? incoming.keeperSettings as object : {}),
    enabled: false,
  }

  // Preserve user-supplied league name / language / timezone
  if (typeof incoming.leagueName === 'string') merged.leagueName = incoming.leagueName
  if (typeof incoming.language === 'string') merged.language = incoming.language
  if (typeof incoming.timezone === 'string') merged.timezone = incoming.timezone

  return merged
}
