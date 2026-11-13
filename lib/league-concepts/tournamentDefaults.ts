/**
 * Canonical tournament league defaults — Phase 1 single source of truth for NFL
 * and NCAAF tournament creation. Mirrors the redraft/dynasty/bestBall/guillotine
 * pattern. Enforces tournament invariants: multi-league elimination structure,
 * sport-specific pool isolation, no dynasty/taxi/keeper/devy/C2C.
 *
 * PHASE 1 SCOPE — this module covers:
 *   - canonical settings snapshot and validation
 *   - concept preset wiring
 *   - creation snapshot with tournament_structure
 *   - safe UI flags/tabs
 *   - child-league generation marked NOT_STARTED (Phase 2)
 *
 * PHASE 2 (not in this module):
 *   - child league generation engine
 *   - cross-league leaderboard aggregation
 *   - automated advancement / wildcard calculation
 *   - next-round redraft generation
 *   - public tournament landing pages
 *
 * Structure defaults:
 *   participantCount = conferenceCount × teamsPerLeague
 *   NFL:   96 participants = 8 conferences × 12 teams, 3 rounds, 2 advancers
 *   NCAAF: 96 participants = 8 conferences × 12 teams, 3 rounds, 2 advancers
 */
import type { LeagueSport } from '@prisma/client'

// ── Types ─────────────────────────────────────────────────────────────────────

type TournamentEligibleSport = 'NFL' | 'NCAAF'

export const TOURNAMENT_DRAFT_TYPE_IDS = ['snake', 'linear', 'auction'] as const
type TournamentDraftType = (typeof TOURNAMENT_DRAFT_TYPE_IDS)[number]

type EngineDraftType = 'snake' | 'linear' | 'auction'

type TournamentChildLeagueStatus = 'not_started' | 'pending' | 'generated' | 'partially_generated'
type TournamentPhase = 'setup' | 'registration' | 'drafting' | 'round_1' | 'round_2' | 'finals' | 'complete'
type TournamentAdvancementMode = 'top_n_per_league' | 'points_wildcard' | 'hybrid'

interface TournamentStructure {
  participantCount: number
  conferenceCount: number
  leaguesPerConference: number
  teamsPerLeague: number
  totalRounds: number
  advancersPerLeague: number
  bubbleEnabled: boolean
  redraftBetweenRounds: boolean
  tradesEnabled: boolean
  namingMode: 'ai_generated' | 'commissioner_custom' | 'hybrid'
  childLeagueGenerationStatus: TournamentChildLeagueStatus
  advancementMode: TournamentAdvancementMode
  tiebreakers: string[]
}

interface TournamentRosterTemplate {
  rosterMode: 'tournament'
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

interface TournamentDraftSettings {
  draftType: EngineDraftType
  requestedDraftType: TournamentDraftType
  rounds: number
  timerSeconds: number
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

interface TournamentDefaultContract {
  sport: TournamentEligibleSport
  league_type: 'tournament'
  leagueType: 'tournament'
  tournament_enabled: true
  tournament_phase: TournamentPhase
  draft_type: EngineDraftType
  requested_draft_type: TournamentDraftType
  teams: number
  rounds: number
  timer_seconds: number
  scoring_preset_id: string
  roster_mode: 'tournament'
  tournamentStructure: TournamentStructure
  rosterTemplate: TournamentRosterTemplate
  scoringSettings: Record<string, unknown>
  draftSettings: TournamentDraftSettings
  playerPoolRules: Record<string, unknown>
  tabsEnabled: Record<string, true | 'commissioner'>
  enabledFeatures: Record<string, boolean>
  seasonSettings: Record<string, unknown>
  creationPlan: Record<string, unknown>
}

// ── Roster configs ─────────────────────────────────────────────────────────────
// Tournament uses redraft-style rosters with a smaller bench (4) for faster
// draft cadence and more waiver/free-agent activity between rounds.

// NFL: 9 starters (QB:1 RB:2 WR:2 TE:1 FLEX:1 K:1 DST:1), bench:4 → total:13
const NFL_TOURNAMENT_STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 } as const

const NFL_TOURNAMENT_ROSTER_CONFIG = {
  starterSlots: NFL_TOURNAMENT_STARTERS as Record<string, number>,
  benchSlots: 4,
  rosterSize: 13,
  defensePosition: 'DST' as const,
  draftablePlayerPositions: ['QB', 'RB', 'WR', 'TE', 'K', 'DST'],
  queueSizeLimit: 60,
  scoringPreset: 'fb_half_ppr',
  // NFL: 96 = 8 conferences × 12 teams per league; 3 rounds, 2 advance per league
  participantCount: 96,
  conferenceCount: 8,
  teamsPerLeague: 12,
  leaguesPerConference: 1,
  totalRounds: 3,
  advancersPerLeague: 2,
}

// NCAAF: 9 starters (QB:1 RB:2 WR:2 TE:1 FLEX:1 K:1 DEF:1), bench:4 → total:13
const NCAAF_TOURNAMENT_STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 } as const

const NCAAF_TOURNAMENT_ROSTER_CONFIG = {
  starterSlots: NCAAF_TOURNAMENT_STARTERS as Record<string, number>,
  benchSlots: 4,
  rosterSize: 13,
  defensePosition: 'DEF' as const,
  draftablePlayerPositions: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'],
  queueSizeLimit: 70,
  scoringPreset: 'ncaaf_half_ppr',
  participantCount: 96,
  conferenceCount: 8,
  teamsPerLeague: 12,
  leaguesPerConference: 1,
  totalRounds: 3,
  advancersPerLeague: 2,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function isTournamentEligibleSport(sport: unknown): sport is TournamentEligibleSport {
  const normalized = String(sport ?? '').trim().toUpperCase()
  return normalized === 'NFL' || normalized === 'NCAAF'
}

function normalizeEngineDraftType(draftType: unknown): EngineDraftType {
  const raw = String(draftType ?? '').trim().toLowerCase()
  if (raw === 'auction') return 'auction'
  if (raw === 'linear') return 'linear'
  return 'snake'
}

function normalizeTournamentDraftType(value: unknown): TournamentDraftType {
  const raw = String(value ?? '').trim().toLowerCase()
  return (TOURNAMENT_DRAFT_TYPE_IDS as readonly string[]).includes(raw)
    ? (raw as TournamentDraftType)
    : 'snake'
}

function pickOrderForDraftType(dt: TournamentDraftType): 'snake' | 'linear' {
  return normalizeEngineDraftType(dt) === 'linear' ? 'linear' : 'snake'
}

function starterCount(slots: Record<string, number>): number {
  return Object.values(slots).reduce((t, n) => t + n, 0)
}

function rosterConfig(sport: TournamentEligibleSport) {
  return sport === 'NCAAF' ? NCAAF_TOURNAMENT_ROSTER_CONFIG : NFL_TOURNAMENT_ROSTER_CONFIG
}

// ── Builders ──────────────────────────────────────────────────────────────────

function buildTournamentStructure(sport: TournamentEligibleSport): TournamentStructure {
  const cfg = rosterConfig(sport)
  return {
    participantCount: cfg.participantCount,
    conferenceCount: cfg.conferenceCount,
    leaguesPerConference: cfg.leaguesPerConference,
    teamsPerLeague: cfg.teamsPerLeague,
    totalRounds: cfg.totalRounds,
    advancersPerLeague: cfg.advancersPerLeague,
    bubbleEnabled: true,
    redraftBetweenRounds: true,
    tradesEnabled: false,
    namingMode: 'ai_generated',
    // Phase 1: child leagues are NOT auto-generated yet.
    childLeagueGenerationStatus: 'not_started',
    advancementMode: 'top_n_per_league',
    tiebreakers: ['points_for', 'regular_season_rank', 'commissioner'],
  }
}

function buildRosterTemplate(sport: TournamentEligibleSport): TournamentRosterTemplate {
  const cfg = rosterConfig(sport)
  const starters = starterCount(cfg.starterSlots)
  return {
    rosterMode: 'tournament',
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
  sport: TournamentEligibleSport,
  scoringPresetId: string,
): Record<string, unknown> {
  const id = scoringPresetId.toLowerCase()
  const ppr = id.includes('standard') || id.endsWith('_std') ? 0 : id.includes('half') ? 0.5 : 1
  const format = ppr === 0 ? 'standard' : ppr === 1 ? 'ppr' : 'half_ppr'
  const scoringFormat = sport === 'NCAAF' ? `${format}_college` : format
  const templateId =
    sport === 'NCAAF'
      ? format === 'ppr' ? 'default-NCAAF-PPR' : format === 'standard' ? 'default-NCAAF-standard' : 'default-NCAAF-HALF_PPR'
      : format === 'ppr' ? 'default-NFL-PPR' : format === 'standard' ? 'default-NFL-standard' : 'default-NFL-HALF_PPR'
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
    tournament: true,
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
  sport: TournamentEligibleSport,
  draftType: TournamentDraftType,
  rosterTemplate: TournamentRosterTemplate,
): TournamentDraftSettings {
  const cfg = rosterConfig(sport)
  const engineDraftType = normalizeEngineDraftType(draftType)
  const pickOrderRules = pickOrderForDraftType(draftType)
  return {
    draftType: engineDraftType,
    requestedDraftType: draftType,
    rounds: rosterTemplate.draftRounds,
    timerSeconds: 90,
    pickOrderRules,
    snakeOrLinear: pickOrderRules,
    thirdRoundReversal: false,
    autopickBehavior: 'queue-first',
    autopickBehaviorAlias: 'queue_first',
    queueSizeLimit: cfg.queueSizeLimit,
    preDraftRankingSource: 'adp',
    rosterFillOrder: 'starter_first',
    positionFilterBehavior: 'by_eligibility',
    auctionBudgetPerTeam: engineDraftType === 'auction' ? 200 : null,
  }
}

function buildPlayerPoolRules(
  sport: TournamentEligibleSport,
  rosterTemplate: TournamentRosterTemplate,
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

function buildSeasonSettings(sport: TournamentEligibleSport): Record<string, unknown> {
  return {
    scoringPeriod: 'weekly',
    hasPlayoffs: false,
    playoffTeams: 0,
    matchupFormat: 'h2h',
    tradesEnabled: false,
    tradeDeadlineWeek: null,
    tradeReviewMode: 'none',
    waiverEnabled: true,
    // Between-round redraft resets the player pool for the next phase
    redraftBetweenRounds: true,
  }
}

function buildTabsEnabled(): Record<string, true | 'commissioner'> {
  return {
    overview: true,
    tournament_hub: true,
    participants: true,
    standings: true,
    leaderboard: true,
    advancement: true,
    draft: true,
    live_draft: true,
    mock_draft: true,
    settings: 'commissioner',
    commissioner_tools: 'commissioner',
    invite_share: true,
    // child_leagues tab is intentionally omitted until Phase 2 generation exists
  }
}

function buildEnabledFeatures(): Record<string, boolean> {
  return {
    tournament_enabled: true,
    tournament_hub: true,
    advancement_bracket: true,
    child_league_generation: false,       // Phase 2
    cross_league_leaderboard: false,      // Phase 2
    automated_advancement: false,         // Phase 2
    wildcard_calculation: false,          // Phase 2
    invite_share: true,
    waivers: true,
    waivers_enabled: true,
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
    isTournament: true,
    isDynasty: false,
    isRedraft: false,
    isKeeper: false,
    isBestBall: false,
    isGuillotine: false,
  }
}

function buildCreationPlan(
  sport: TournamentEligibleSport,
  structure: TournamentStructure,
): Record<string, unknown> {
  return {
    phase: 'setup' as TournamentPhase,
    // Phase 1: plan is declared but child leagues are NOT yet generated
    childLeagueGenerationStatus: 'not_started' as TournamentChildLeagueStatus,
    childLeagueGenerationNote: 'Child league generation is Phase 2. Use commissioner tools to trigger when ready.',
    expectedChildLeagueCount: structure.conferenceCount * structure.leaguesPerConference,
    expectedTeamsPerChildLeague: structure.teamsPerLeague,
    conferenceNamingMode: structure.namingMode,
    advancementMode: structure.advancementMode,
    advancersPerLeague: structure.advancersPerLeague,
    bubbleEnabled: structure.bubbleEnabled,
    totalRounds: structure.totalRounds,
    redraftBetweenRounds: structure.redraftBetweenRounds,
    roundPlanStatuses: Array.from({ length: structure.totalRounds }, (_, i) => ({
      round: i + 1,
      status: i === 0 ? 'setup' : 'pending',
      childLeagueCount: structure.conferenceCount,
      teamsPerLeague: structure.teamsPerLeague,
    })),
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getTournamentDefaultContract(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): TournamentDefaultContract | null {
  const normalizedSport = String(input.sport ?? '').trim().toUpperCase()
  if (!isTournamentEligibleSport(normalizedSport)) return null

  const sport = normalizedSport
  const cfg = rosterConfig(sport)
  const requestedDraftType = normalizeTournamentDraftType(input.draftType)
  const tournamentStructure = buildTournamentStructure(sport)
  const rosterTemplate = buildRosterTemplate(sport)
  const draftSettings = buildDraftSettings(sport, requestedDraftType, rosterTemplate)
  const scoringPresetId =
    typeof input.scoringPresetId === 'string' && input.scoringPresetId.trim()
      ? input.scoringPresetId.trim()
      : cfg.scoringPreset
  const scoringSettings = buildScoringSettings(sport, scoringPresetId)
  const playerPoolRules = buildPlayerPoolRules(sport, rosterTemplate)
  const seasonSettings = buildSeasonSettings(sport)
  const tabsEnabled = buildTabsEnabled()
  const enabledFeatures = buildEnabledFeatures()
  const creationPlan = buildCreationPlan(sport, tournamentStructure)
  // teamCount for tournament = teamsPerLeague (individual child-league size)
  const teamCount =
    typeof input.teamCount === 'number' && input.teamCount > 0
      ? Math.floor(input.teamCount)
      : cfg.teamsPerLeague

  return {
    sport,
    league_type: 'tournament',
    leagueType: 'tournament',
    tournament_enabled: true,
    tournament_phase: 'setup',
    draft_type: draftSettings.draftType,
    requested_draft_type: requestedDraftType,
    teams: teamCount,
    rounds: draftSettings.rounds,
    timer_seconds: draftSettings.timerSeconds,
    scoring_preset_id: scoringPresetId,
    roster_mode: 'tournament',
    tournamentStructure,
    rosterTemplate,
    scoringSettings,
    draftSettings,
    playerPoolRules,
    tabsEnabled,
    enabledFeatures,
    seasonSettings,
    creationPlan,
  }
}

export function buildTournamentSettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): Record<string, unknown> | null {
  const contract = getTournamentDefaultContract(input)
  if (!contract) return null

  const { draftSettings, rosterTemplate, tournamentStructure } = contract
  return {
    tournamentDefaultsVersion: 1,
    sport: contract.sport,
    sport_type: contract.sport,
    leagueType: 'tournament',
    league_type: 'tournament',
    roster_mode: 'tournament',
    tournament_enabled: true,
    tournament_phase: contract.tournament_phase,
    isTournament: true,
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
      rosterMode: 'tournament',
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
    seasonSettings: contract.seasonSettings,
    tournamentStructure,
    tournament_structure: tournamentStructure,
    participant_count: tournamentStructure.participantCount,
    conference_count: tournamentStructure.conferenceCount,
    leagues_per_conference: tournamentStructure.leaguesPerConference,
    teams_per_league: tournamentStructure.teamsPerLeague,
    total_rounds: tournamentStructure.totalRounds,
    advancers_per_league: tournamentStructure.advancersPerLeague,
    bubble_enabled: tournamentStructure.bubbleEnabled,
    redraft_between_rounds: tournamentStructure.redraftBetweenRounds,
    trades_enabled: tournamentStructure.tradesEnabled,
    advancement_mode: tournamentStructure.advancementMode,
    child_league_generation_status: tournamentStructure.childLeagueGenerationStatus,
    playerPoolRules: contract.playerPoolRules,
    player_pool_rules: contract.playerPoolRules,
    player_pool: contract.playerPoolRules.poolKey,
    tabsEnabled: contract.tabsEnabled,
    tabs_enabled: contract.tabsEnabled,
    creationPlan: contract.creationPlan,
    creation_plan: contract.creationPlan,
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

export function normalizeTournamentSettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
  settings?: Record<string, unknown> | null
}): Record<string, unknown> {
  const incoming = input.settings ?? {}
  const requestedDraftType = normalizeTournamentDraftType(
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
    buildTournamentSettingsSnapshot({
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

  // Enforce tournament invariants
  merged.league_type = 'tournament'
  merged.leagueType = 'tournament'
  merged.roster_mode = 'tournament'
  merged.tournament_enabled = true
  merged.isTournament = true
  merged.isDynasty = false
  merged.isRedraft = false
  merged.isKeeper = false
  merged.isBestBall = false
  merged.isGuillotine = false

  // Hard guardrails
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
  // Phase 1: child league generation must never be auto-set to generated
  merged.child_league_generation_status = 'not_started'

  // Preserve user-supplied league name / language / timezone
  if (typeof incoming.leagueName === 'string') merged.leagueName = incoming.leagueName
  if (typeof incoming.language === 'string') merged.language = incoming.language
  if (typeof incoming.timezone === 'string') merged.timezone = incoming.timezone

  return merged
}

// ── Validation ────────────────────────────────────────────────────────────────

interface TournamentValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validateTournamentStructure(input: {
  participantCount: number
  conferenceCount: number
  leaguesPerConference: number
  teamsPerLeague: number
  totalRounds: number
  advancersPerLeague: number
}): TournamentValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const { participantCount, conferenceCount, leaguesPerConference, teamsPerLeague, totalRounds, advancersPerLeague } = input

  const expectedParticipants = conferenceCount * leaguesPerConference * teamsPerLeague
  if (expectedParticipants !== participantCount) {
    errors.push(
      `participantCount (${participantCount}) does not match conferenceCount × leaguesPerConference × teamsPerLeague (${expectedParticipants}).`,
    )
  }

  if (advancersPerLeague >= teamsPerLeague) {
    errors.push(`advancersPerLeague (${advancersPerLeague}) must be less than teamsPerLeague (${teamsPerLeague}).`)
  }

  const maxRoundsFromAdvancers = Math.ceil(Math.log2(conferenceCount * leaguesPerConference))
  if (totalRounds < 1) {
    errors.push('totalRounds must be at least 1.')
  } else if (totalRounds > maxRoundsFromAdvancers + 1) {
    warnings.push(
      `totalRounds (${totalRounds}) may be more than needed for ${conferenceCount * leaguesPerConference} leagues advancing ${advancersPerLeague} each.`,
    )
  }

  if (teamsPerLeague < 2) {
    errors.push('teamsPerLeague must be at least 2.')
  }

  if (conferenceCount < 1) {
    errors.push('conferenceCount must be at least 1.')
  }

  return { valid: errors.length === 0, errors, warnings }
}
