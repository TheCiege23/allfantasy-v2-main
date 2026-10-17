import type { LeagueSport } from '@prisma/client'

export type FootballKeeperSport = 'NFL' | 'NCAAF'
export type KeeperDraftType =
  | 'snake'
  | 'linear'
  | 'auction'
  | 'slow_draft'
  | 'offline'
  | 'auto'
  | 'mock_draft'
  | 'team'

export type KeeperDraftSurface = 'live' | 'mock'

type EngineDraftType = 'snake' | 'linear' | 'auction'
type KeeperCostSystem = 'round_based' | 'auction_value'

export interface KeeperRosterTemplate {
  rosterMode: 'keeper'
  starterSlots: Record<string, number>
  flexDefinitions: Array<{ slotName: string; allowedPositions: string[] }>
  benchSlots: number
  irSlots: number
  taxiSlots: 0
  keeperSlots: number
  rosterSlots: number
  draftableRosterSlots: number
  totalRosterSlots: number
  rosterPositions: string[]
  draftablePlayerPositions: string[]
  defensePosition: 'DST' | 'DEF'
}

export interface KeeperPolicySettings {
  enabled: true
  maxKeepers: number
  maxYears: number
  eligibilityRule: 'any'
  costSystem: KeeperCostSystem
  roundPenalty: number
  auctionPctIncrease: number
  waiverAllowed: boolean
  conflictRule: 'player_chooses'
  missedDeadlineRule: 'auto_no_keepers'
  declarationDeadlineDefault: 'before_draft'
  declarationDeadline: string | null
  maxKeepersPerPosition: Record<string, number> | null
  keptPlayerRoundCostsEnabled: boolean
  keptPlayersRemovedFromPool: true
  draftRoundAdjustmentsEnabled: boolean
  keptPlayerBudgetDeductionsEnabled: boolean
  rosterNeedsAccountForKeepers: true
}

export interface KeeperDraftSettings {
  draftType: EngineDraftType
  requestedDraftType: KeeperDraftType
  engineCore: EngineDraftType
  rounds: number
  fallbackRounds: number
  timerSeconds: number
  slowTimerSeconds: number
  pickWindowHours: number | null
  pickOrderRules: 'snake' | 'linear'
  snakeOrLinear: 'snake' | 'linear'
  sameOrderEveryRound: boolean
  thirdRoundReversal: false
  autopickBehavior: 'queue-first'
  autopickBehaviorAlias: 'queue_first'
  queueSizeLimit: number
  preDraftRankingSource: string
  rosterFillOrder: string
  positionFilterBehavior: string
  auctionBudgetPerTeam: number | null
  nominationOrderEnabled: boolean
  timerDisabled: boolean
  slowDraftEnabled: boolean
  overnightPauseEnabled: boolean
  remindersEnabled: boolean
  mockDraftEnabled: boolean
  usesKeeperSettings: boolean
  doesNotMutateRealRosters: boolean
  keeperCostsVisible: boolean
  offlineModeEnabled: boolean
  commissionerPickEntryEnabled: boolean
  autoDraftEnabled: boolean
  eligiblePoolExcludesKeepers: true
  rosterNeedsAccountForKeepers: true
  teamDraftModeEnabled: boolean
  coManagerControlsEnabled: boolean
  keeperDeclarationPermissionsClear: boolean
}

export interface KeeperDefaultContract {
  sport: FootballKeeperSport
  league_type: 'keeper'
  leagueType: 'keeper'
  draft_type: EngineDraftType
  requested_draft_type: KeeperDraftType
  teams: number
  rounds: number
  timer_seconds: number
  scoring_preset_id: string
  scoringPresetAliases: string[]
  roster_mode: 'keeper'
  rosterTemplate: KeeperRosterTemplate
  scoringSettings: Record<string, unknown>
  waiverSettings: Record<string, unknown>
  tradeSettings: Record<string, unknown>
  draftSettings: KeeperDraftSettings
  keeperPolicy: KeeperPolicySettings
  playerPoolRules: Record<string, unknown>
  tabsEnabled: Record<string, true | 'commissioner'>
  mockDraftRules: Record<string, unknown>
  liveDraftRules: Record<string, unknown>
  disabledSettings: Record<string, unknown>
}

export const KEEPER_DRAFT_TYPE_IDS: readonly KeeperDraftType[] = [
  'snake',
  'linear',
  'auction',
  'slow_draft',
  'offline',
  'auto',
  'mock_draft',
  'team',
] as const

const NFL_STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 } as const
// No DEF: no college team defense exists to draft and none is scored (see redraftTeamDefenseEnabled).
const NCAAF_STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1 } as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (value === true || value === false) return value
  return fallback
}

function starterCount(starters: Record<string, number>): number {
  return Object.values(starters).reduce((total, count) => total + count, 0)
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

export function isFootballKeeperDefaultsSport(sport: unknown): sport is FootballKeeperSport {
  const normalized = String(sport ?? '').trim().toUpperCase()
  return normalized === 'NFL' || normalized === 'NCAAF'
}

export function normalizeKeeperDraftType(value: unknown): KeeperDraftType {
  const raw = String(value ?? '').trim().toLowerCase()
  const normalized =
    raw === 'slow'
      ? 'slow_draft'
      : raw === 'mock'
        ? 'mock_draft'
        : raw
  return (KEEPER_DRAFT_TYPE_IDS as readonly string[]).includes(normalized)
    ? (normalized as KeeperDraftType)
    : 'snake'
}

export function getKeeperEngineDraftType(draftType: unknown): EngineDraftType {
  const normalized = normalizeKeeperDraftType(draftType)
  if (normalized === 'auction') return 'auction'
  if (normalized === 'linear') return 'linear'
  return 'snake'
}

function pickOrderForDraftType(draftType: unknown): 'snake' | 'linear' {
  return getKeeperEngineDraftType(draftType) === 'linear' ? 'linear' : 'snake'
}

function defaultScoringPresetId(sport: FootballKeeperSport): string {
  return sport === 'NCAAF' ? 'ncaaf_half_ppr' : 'fb_half_ppr'
}

function scoringPprValue(presetId: string): number {
  const id = presetId.toLowerCase()
  if (id.includes('standard') || id.endsWith('_std') || id === 'fb_std') return 0
  if (id.includes('half')) return 0.5
  if (id.includes('ppr')) return 1
  return 0.5
}

function scoringFormatForPreset(presetId: string): string {
  const ppr = scoringPprValue(presetId)
  if (ppr === 0) return 'standard'
  if (ppr === 1) return 'ppr'
  return 'half_ppr'
}

function scoringTemplateId(sport: FootballKeeperSport, presetId: string): string {
  const format = scoringFormatForPreset(presetId)
  if (sport === 'NCAAF') {
    if (format === 'standard') return 'default-NCAAF-standard'
    if (format === 'ppr') return 'default-NCAAF-PPR'
    return 'default-NCAAF-HALF_PPR'
  }
  if (format === 'standard') return 'default-NFL-standard'
  if (format === 'ppr') return 'default-NFL-PPR'
  return 'default-NFL-HALF_PPR'
}

function scoringAliasesForPreset(sport: FootballKeeperSport, presetId: string): string[] {
  const format = scoringFormatForPreset(presetId)
  if (sport === 'NCAAF') {
    if (format === 'standard') return ['standard_college', 'ncaaf_standard_college']
    if (format === 'ppr') return ['ppr_college', 'ncaaf_ppr_college']
    return ['half_ppr_college', 'ncaaf_half_ppr_college']
  }
  if (format === 'standard') return ['standard', 'fb_standard']
  if (format === 'ppr') return ['ppr', 'fb_full_ppr', 'fb_ppr']
  return ['half_ppr', 'fb_half_ppr']
}

function buildRosterTemplate(sport: FootballKeeperSport): KeeperRosterTemplate {
  const starterSlots = sport === 'NCAAF' ? { ...NCAAF_STARTERS } : { ...NFL_STARTERS }
  const rosterPositions = Object.keys(starterSlots)
  const draftablePlayerPositions =
    sport === 'NCAAF'
      ? ['QB', 'RB', 'WR', 'TE', 'K']
      : ['QB', 'RB', 'WR', 'TE', 'K', 'DST']
  const benchSlots = sport === 'NCAAF' ? 8 : 7
  const irSlots = 2
  const rosterSlots = starterCount(starterSlots)
  return {
    rosterMode: 'keeper',
    starterSlots,
    flexDefinitions: [{ slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'] }],
    benchSlots,
    irSlots,
    taxiSlots: 0,
    keeperSlots: 3,
    rosterSlots,
    draftableRosterSlots: rosterSlots + benchSlots,
    totalRosterSlots: rosterSlots + benchSlots + irSlots,
    rosterPositions,
    draftablePlayerPositions,
    defensePosition: sport === 'NCAAF' ? 'DEF' : 'DST',
  }
}

function buildScoringSettings(
  sport: FootballKeeperSport,
  scoringPresetId: string,
): Record<string, unknown> {
  const format = scoringFormatForPreset(scoringPresetId)
  const ppr = scoringPprValue(scoringPresetId)
  return {
    source: 'af',
    sport,
    preset: scoringPresetId,
    scoringPresetId,
    scoringTemplateId: scoringTemplateId(sport, scoringPresetId),
    scoringMode: 'points',
    scoringFormat: sport === 'NCAAF' ? `${format}_college` : format,
    format,
    ppr,
    superflex: false,
    tePremium: false,
    tePremiumMultiplier: 1,
    idp: false,
    keeper: true,
    dynasty: false,
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

function buildKeeperPolicy(draftType: KeeperDraftType): KeeperPolicySettings {
  const isAuction = getKeeperEngineDraftType(draftType) === 'auction'
  return {
    enabled: true,
    maxKeepers: 3,
    maxYears: 3,
    eligibilityRule: 'any',
    costSystem: isAuction ? 'auction_value' : 'round_based',
    roundPenalty: 1,
    auctionPctIncrease: 0.2,
    waiverAllowed: true,
    conflictRule: 'player_chooses',
    missedDeadlineRule: 'auto_no_keepers',
    declarationDeadlineDefault: 'before_draft',
    declarationDeadline: null,
    maxKeepersPerPosition: null,
    keptPlayerRoundCostsEnabled: !isAuction,
    keptPlayersRemovedFromPool: true,
    draftRoundAdjustmentsEnabled: !isAuction,
    keptPlayerBudgetDeductionsEnabled: isAuction,
    rosterNeedsAccountForKeepers: true,
  }
}

function buildDraftSettings(
  sport: FootballKeeperSport,
  draftType: KeeperDraftType,
  rosterTemplate: KeeperRosterTemplate,
): KeeperDraftSettings {
  const engineDraftType = getKeeperEngineDraftType(draftType)
  const pickOrderRules = pickOrderForDraftType(draftType)
  const isAuction = engineDraftType === 'auction'
  const isSlow = draftType === 'slow_draft'
  const isMock = draftType === 'mock_draft'
  const isOffline = draftType === 'offline'
  const isAuto = draftType === 'auto'
  const isTeam = draftType === 'team'
  return {
    draftType: engineDraftType,
    requestedDraftType: draftType,
    engineCore: engineDraftType,
    rounds: rosterTemplate.draftableRosterSlots,
    fallbackRounds: sport === 'NCAAF' ? 20 : rosterTemplate.draftableRosterSlots,
    timerSeconds: 90,
    slowTimerSeconds: 28_800,
    pickWindowHours: isSlow ? 8 : null,
    pickOrderRules,
    snakeOrLinear: pickOrderRules,
    sameOrderEveryRound: pickOrderRules === 'linear',
    thirdRoundReversal: false,
    autopickBehavior: 'queue-first',
    autopickBehaviorAlias: 'queue_first',
    queueSizeLimit: sport === 'NCAAF' ? 70 : 60,
    preDraftRankingSource: sport === 'NCAAF' ? 'adp_projection_rank_fallback' : 'adp',
    rosterFillOrder: 'position_scarcity',
    positionFilterBehavior: 'by_eligibility',
    auctionBudgetPerTeam: isAuction ? 200 : null,
    nominationOrderEnabled: isAuction,
    timerDisabled: isOffline,
    slowDraftEnabled: isSlow,
    overnightPauseEnabled: isSlow,
    remindersEnabled: isSlow,
    mockDraftEnabled: isMock,
    usesKeeperSettings: isMock,
    doesNotMutateRealRosters: isMock,
    keeperCostsVisible: isAuction || isMock || isOffline,
    offlineModeEnabled: isOffline,
    commissionerPickEntryEnabled: isOffline,
    autoDraftEnabled: isAuto,
    eligiblePoolExcludesKeepers: true,
    rosterNeedsAccountForKeepers: true,
    teamDraftModeEnabled: isTeam,
    coManagerControlsEnabled: isTeam,
    keeperDeclarationPermissionsClear: isTeam,
  }
}

function buildPlayerPoolRules(
  sport: FootballKeeperSport,
  rosterTemplate: KeeperRosterTemplate,
): Record<string, unknown> {
  const positions = rosterTemplate.draftablePlayerPositions
  const common = {
    includeActiveOnly: true,
    rookieOnly: false,
    excludeRookieOnlyPool: true,
    keptPlayersRemovedFromPool: true,
    keptPlayersMarkedUnavailableInMock: true,
    rosterNeedsAccountForKeepers: true,
    eligiblePoolExcludesKeepers: true,
    positions,
  }
  if (sport === 'NCAAF') {
    return {
      ...common,
      sport: 'NCAAF',
      poolKey: 'ncaaf_active_college_fantasy_players',
      source: 'sports_player',
      includeCollegePlayers: true,
      includeNflPlayers: false,
      collegeOnly: true,
      excludeNflPool: true,
      positionAliases: { DEF: ['DST'] },
      rankingSource: 'adp_projection_rank_fallback',
    }
  }
  return {
    ...common,
    sport: 'NFL',
    poolKey: 'nfl_active_fantasy_players',
    source: 'sports_player',
    includeCollegePlayers: false,
    includeNflPlayers: true,
    collegeOnly: false,
    excludeCollegePool: true,
    positionAliases: { DST: ['DEF'] },
    rankingSource: 'adp',
  }
}

function buildWaiverSettings(policy: KeeperPolicySettings): Record<string, unknown> {
  return {
    waiverType: 'faab',
    faabBudget: 100,
    processingDays: [2],
    processingTimeUtc: '10:00',
    keeperWaiverAllowed: policy.waiverAllowed,
    freeAgentUnlockBehavior: 'after_waiver_run',
    gameLockBehavior: 'game_time',
  }
}

function buildTradeSettings(): Record<string, unknown> {
  return {
    tradeCenterEnabled: true,
    tradeReviewMode: 'commissioner',
    futureRookiePicksEnabled: false,
    keeperTradeContextEnabled: true,
  }
}

function buildDisabledSettings(): Record<string, unknown> {
  return {
    taxi: false,
    taxi_enabled: false,
    taxi_slots: 0,
    taxiSlots: 0,
    devy: false,
    devy_enabled: false,
    c2c: false,
    c2c_enabled: false,
    dynasty: false,
    dynasty_carryover: false,
    full_roster_carryover: false,
    future_rookie_picks: false,
    future_rookie_picks_enabled: false,
    future_picks: false,
    future_picks_enabled: false,
    contracts: false,
    contracts_enabled: false,
    salary_cap: false,
    salary_cap_enabled: false,
    rookie_only: false,
    rookie_only_pool: false,
    isDynasty: false,
  }
}

function buildTabsEnabled(): Record<string, true | 'commissioner'> {
  return {
    overview: true,
    teams: true,
    roster: true,
    rosters: true,
    standings: true,
    matchups: true,
    draft: true,
    mock_draft: true,
    live_draft: true,
    keeper_declarations: true,
    keeper: true,
    trade_center: true,
    trades: true,
    waivers: true,
    settings: 'commissioner',
    commissioner_tools: 'commissioner',
  }
}

function buildSurfaceRules(
  surface: KeeperDraftSurface,
  draftSettings: KeeperDraftSettings,
): Record<string, unknown> {
  return {
    enabled: true,
    surface,
    draftConfigSource: 'League.settings',
    useResolvedDraftSettings: true,
    sharesResolvedDraftConfig: true,
    draftType: draftSettings.draftType,
    requestedDraftType: draftSettings.requestedDraftType,
    rounds: draftSettings.rounds,
    timerSeconds: draftSettings.timerSeconds,
    queueSizeLimit: draftSettings.queueSizeLimit,
    autopickBehavior: draftSettings.autopickBehavior,
    positionFilterBehavior: draftSettings.positionFilterBehavior,
    usesKeeperSettings: true,
    keeperCostsVisible: true,
    keptPlayersRemovedFromPool: true,
    doesNotMutateRealRosters: surface === 'mock',
    doesNotMutateKeeperDeclarations: surface === 'mock',
  }
}

export function getKeeperDefaultContract(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): KeeperDefaultContract | null {
  const normalizedSport = String(input.sport ?? '').trim().toUpperCase()
  if (!isFootballKeeperDefaultsSport(normalizedSport)) return null

  const sport = normalizedSport
  const requestedDraftType = normalizeKeeperDraftType(input.draftType)
  const rosterTemplate = buildRosterTemplate(sport)
  const draftSettings = buildDraftSettings(sport, requestedDraftType, rosterTemplate)
  const scoringPresetId =
    typeof input.scoringPresetId === 'string' && input.scoringPresetId.trim()
      ? input.scoringPresetId.trim()
      : defaultScoringPresetId(sport)
  const scoringSettings = buildScoringSettings(sport, scoringPresetId)
  const keeperPolicy = buildKeeperPolicy(requestedDraftType)
  const playerPoolRules = buildPlayerPoolRules(sport, rosterTemplate)
  const tabsEnabled = buildTabsEnabled()
  const disabledSettings = buildDisabledSettings()

  return {
    sport,
    league_type: 'keeper',
    leagueType: 'keeper',
    draft_type: draftSettings.draftType,
    requested_draft_type: requestedDraftType,
    teams: asPositiveInt(input.teamCount, 12),
    rounds: draftSettings.rounds,
    timer_seconds: draftSettings.timerSeconds,
    scoring_preset_id: scoringPresetId,
    scoringPresetAliases: scoringAliasesForPreset(sport, scoringPresetId),
    roster_mode: 'keeper',
    rosterTemplate,
    scoringSettings,
    waiverSettings: buildWaiverSettings(keeperPolicy),
    tradeSettings: buildTradeSettings(),
    draftSettings,
    keeperPolicy,
    playerPoolRules,
    tabsEnabled,
    mockDraftRules: buildSurfaceRules('mock', draftSettings),
    liveDraftRules: buildSurfaceRules('live', draftSettings),
    disabledSettings,
  }
}

export function getKeeperDraftSettingsForSurface(
  contract: KeeperDefaultContract,
  surface: KeeperDraftSurface,
): KeeperDraftSettings {
  const surfaceRules = surface === 'mock' ? contract.mockDraftRules : contract.liveDraftRules
  return {
    ...contract.draftSettings,
    draftType: surfaceRules.draftType as EngineDraftType,
    requestedDraftType: surfaceRules.requestedDraftType as KeeperDraftType,
  }
}

export function buildKeeperSettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): Record<string, unknown> | null {
  const contract = getKeeperDefaultContract(input)
  if (!contract) return null

  const { draftSettings, keeperPolicy, rosterTemplate } = contract
  return {
    keeperDefaultsVersion: 1,
    sport: contract.sport,
    sport_type: contract.sport,
    leagueType: 'keeper',
    league_type: 'keeper',
    roster_mode: 'keeper',
    isKeeper: true,
    teams: contract.teams,
    default_team_count: contract.teams,
    scoring_preset_id: contract.scoring_preset_id,
    scoringPreset: contract.scoring_preset_id,
    scoringPresetAliases: contract.scoringPresetAliases,
    scoring_mode: 'points',
    scoring_format: contract.scoringSettings.scoringFormat,
    scoring_template_id: contract.scoringSettings.scoringTemplateId,
    draft_type: draftSettings.draftType,
    requested_draft_type: draftSettings.requestedDraftType,
    draft_rounds: draftSettings.rounds,
    draft_timer_seconds: draftSettings.timerSeconds,
    draft_slow_timer_seconds: draftSettings.slowTimerSeconds,
    draft_pick_window_hours: draftSettings.pickWindowHours,
    draft_pick_order_rules: draftSettings.pickOrderRules,
    draft_snake_or_linear: draftSettings.snakeOrLinear,
    draft_same_order_every_round: draftSettings.sameOrderEveryRound,
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
    roster_size: rosterTemplate.draftableRosterSlots,
    rosterSize: rosterTemplate.draftableRosterSlots,
    starter_slots: rosterTemplate.starterSlots,
    bench_slots: rosterTemplate.benchSlots,
    ir_slots: rosterTemplate.irSlots,
    taxi_slots: 0,
    rosterTemplate,
    rosterSettings: {
      rosterMode: 'keeper',
      starterSlots: rosterTemplate.starterSlots,
      flexDefinitions: rosterTemplate.flexDefinitions,
      benchSlots: rosterTemplate.benchSlots,
      irSlots: rosterTemplate.irSlots,
      taxiSlots: 0,
      keeperSlots: keeperPolicy.maxKeepers,
      rosterSlots: rosterTemplate.rosterSlots,
      rosterSize: rosterTemplate.draftableRosterSlots,
      rosterPositions: rosterTemplate.rosterPositions,
      draftablePlayerPositions: rosterTemplate.draftablePlayerPositions,
      rosterNeedsAccountForKeepers: true,
    },
    scoringSettings: contract.scoringSettings,
    waiverSettings: contract.waiverSettings,
    tradeSettings: contract.tradeSettings,
    draftSettings,
    playerPoolRules: contract.playerPoolRules,
    player_pool_rules: contract.playerPoolRules,
    player_pool: contract.playerPoolRules.poolKey,
    tabsEnabled: contract.tabsEnabled,
    tabs_enabled: contract.tabsEnabled,
    mockDraftRules: contract.mockDraftRules,
    mock_draft_rules: contract.mockDraftRules,
    liveDraftRules: contract.liveDraftRules,
    live_draft_rules: contract.liveDraftRules,
    keeper_enabled: true,
    keepers: true,
    keepers_enabled: true,
    keeper_carryover_enabled: true,
    keeper_max_keepers: keeperPolicy.maxKeepers,
    keeperMaxKeepers: keeperPolicy.maxKeepers,
    keeperCount: keeperPolicy.maxKeepers,
    keeper_max_years: keeperPolicy.maxYears,
    keeperMaxYears: keeperPolicy.maxYears,
    keeper_eligibility_rule: keeperPolicy.eligibilityRule,
    keeperEligibilityRule: keeperPolicy.eligibilityRule,
    keeper_cost_system: keeperPolicy.costSystem,
    keeperCostSystem: keeperPolicy.costSystem,
    keeper_round_penalty: keeperPolicy.roundPenalty,
    keeperRoundPenalty: keeperPolicy.roundPenalty,
    keeper_auction_pct_increase: keeperPolicy.auctionPctIncrease,
    keeperAuctionPctIncrease: keeperPolicy.auctionPctIncrease,
    keeper_waiver_allowed: keeperPolicy.waiverAllowed,
    keeperWaiverAllowed: keeperPolicy.waiverAllowed,
    keeper_conflict_rule: keeperPolicy.conflictRule,
    keeperConflictRule: keeperPolicy.conflictRule,
    keeper_missed_deadline_rule: keeperPolicy.missedDeadlineRule,
    keeperMissedDeadlineRule: keeperPolicy.missedDeadlineRule,
    keeper_declaration_deadline_default: keeperPolicy.declarationDeadlineDefault,
    keeper_declaration_deadline: keeperPolicy.declarationDeadline,
    keeperSelectionDeadline: keeperPolicy.declarationDeadline,
    keeper_max_per_position: keeperPolicy.maxKeepersPerPosition,
    kept_player_round_costs_enabled: keeperPolicy.keptPlayerRoundCostsEnabled,
    kept_players_removed_from_pool: keeperPolicy.keptPlayersRemovedFromPool,
    draft_round_adjustments_enabled: keeperPolicy.draftRoundAdjustmentsEnabled,
    kept_player_budget_deductions_enabled: keeperPolicy.keptPlayerBudgetDeductionsEnabled,
    roster_needs_account_for_keepers: keeperPolicy.rosterNeedsAccountForKeepers,
    keeperSettings: keeperPolicy,
    ...contract.disabledSettings,
    devyConfig: { enabled: false },
    c2cConfig: { enabled: false },
    salaryCapSettings: { enabled: false },
    contractSettings: { enabled: false },
  }
}

export function normalizeKeeperSettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
  settings?: Record<string, unknown> | null
}): Record<string, unknown> {
  const incoming = input.settings ?? {}
  const requestedDraftType = normalizeKeeperDraftType(
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
    buildKeeperSettingsSnapshot({
      sport: input.sport,
      draftType: requestedDraftType,
      scoringPresetId,
      teamCount,
    }) ?? {}
  const resolvedScoringPresetId =
    typeof scoringPresetId === 'string' && scoringPresetId.trim()
      ? scoringPresetId.trim()
      : String(defaults.scoring_preset_id ?? '')

  const merged: Record<string, unknown> = {
    ...defaults,
    ...incoming,
  }
  const draftSettings = isRecord(incoming.draftSettings) ? incoming.draftSettings : {}
  const keeperSettings = isRecord(incoming.keeperSettings) ? incoming.keeperSettings : {}
  const defaultDraftSettings = (defaults.draftSettings as KeeperDraftSettings | undefined) ?? null
  const defaultKeeperPolicy = (defaults.keeperSettings as KeeperPolicySettings | undefined) ?? null
  const defaultRounds = defaultDraftSettings?.rounds ?? asPositiveInt(defaults.draft_rounds, 16)
  const defaultTimer = defaultDraftSettings?.timerSeconds ?? 90
  const defaultSlowTimer = defaultDraftSettings?.slowTimerSeconds ?? 28_800
  const rounds = asPositiveInt(merged.draft_rounds ?? draftSettings.rounds, defaultRounds)
  const timerSeconds = asPositiveInt(merged.draft_timer_seconds ?? draftSettings.timerSeconds, defaultTimer)
  const queueSizeLimit = asPositiveInt(
    merged.draft_queue_size_limit ?? draftSettings.queueSizeLimit,
    defaultDraftSettings?.queueSizeLimit ?? 60,
  )
  const engineDraftType = getKeeperEngineDraftType(requestedDraftType)
  const pickOrderRules = pickOrderForDraftType(requestedDraftType)
  const isAuction = engineDraftType === 'auction'
  const keeperMaxKeepers = clampInt(
    merged.keeper_max_keepers ?? merged.keeperMaxKeepers ?? keeperSettings.maxKeepers ?? merged.keeperCount,
    defaultKeeperPolicy?.maxKeepers ?? 3,
    0,
    32,
  )
  const keeperMaxYears = clampInt(
    merged.keeper_max_years ?? merged.keeperMaxYears ?? keeperSettings.maxYears,
    defaultKeeperPolicy?.maxYears ?? 3,
    0,
    20,
  )
  const keeperRoundPenalty = clampInt(
    merged.keeper_round_penalty ?? merged.keeperRoundPenalty ?? keeperSettings.roundPenalty,
    defaultKeeperPolicy?.roundPenalty ?? 1,
    0,
    10,
  )
  const auctionPct = Number(
    merged.keeper_auction_pct_increase ??
      merged.keeperAuctionPctIncrease ??
      keeperSettings.auctionPctIncrease ??
      defaultKeeperPolicy?.auctionPctIncrease ??
      0.2,
  )
  const safeAuctionPct = Number.isFinite(auctionPct) && auctionPct >= 0 ? auctionPct : 0.2
  const costSystem: KeeperCostSystem = isAuction ? 'auction_value' : 'round_based'
  const waiverAllowed = asBoolean(
    merged.keeper_waiver_allowed ?? merged.keeperWaiverAllowed ?? keeperSettings.waiverAllowed,
    true,
  )

  merged.draft_type = engineDraftType
  merged.requested_draft_type = requestedDraftType
  merged.draft_rounds = rounds
  merged.rounds = rounds
  merged.draft_timer_seconds = timerSeconds
  merged.timer_seconds = timerSeconds
  merged.draft_slow_timer_seconds = asPositiveInt(
    merged.draft_slow_timer_seconds ?? draftSettings.slowTimerSeconds,
    defaultSlowTimer,
  )
  merged.draft_pick_window_hours =
    requestedDraftType === 'slow_draft'
      ? asPositiveInt(merged.draft_pick_window_hours ?? draftSettings.pickWindowHours, 8)
      : null
  merged.draft_pick_order_rules = pickOrderRules
  merged.draft_snake_or_linear = pickOrderRules
  merged.draft_same_order_every_round = pickOrderRules === 'linear'
  merged.draft_third_round_reversal = false
  merged.third_round_reversal = false
  merged.draft_queue_size_limit = queueSizeLimit
  merged.queue_size_limit = queueSizeLimit
  merged.draft_autopick_behavior =
    typeof merged.draft_autopick_behavior === 'string' && merged.draft_autopick_behavior.trim()
      ? merged.draft_autopick_behavior
      : defaultDraftSettings?.autopickBehavior ?? 'queue-first'
  merged.draft_pre_draft_ranking_source =
    typeof merged.draft_pre_draft_ranking_source === 'string' && merged.draft_pre_draft_ranking_source.trim()
      ? merged.draft_pre_draft_ranking_source
      : defaultDraftSettings?.preDraftRankingSource ?? 'adp'
  merged.draft_roster_fill_order =
    typeof merged.draft_roster_fill_order === 'string' && merged.draft_roster_fill_order.trim()
      ? merged.draft_roster_fill_order
      : defaultDraftSettings?.rosterFillOrder ?? 'position_scarcity'
  merged.draft_position_filter_behavior =
    typeof merged.draft_position_filter_behavior === 'string' && merged.draft_position_filter_behavior.trim()
      ? merged.draft_position_filter_behavior
      : defaultDraftSettings?.positionFilterBehavior ?? 'by_eligibility'
  merged.scoring_preset_id = resolvedScoringPresetId
  merged.scoringPreset = resolvedScoringPresetId
  merged.scoring_template_id = defaults.scoring_template_id
  merged.scoring_format = defaults.scoring_format
  merged.scoring_mode = 'points'

  const defaultRosterTemplate = defaults.rosterTemplate as KeeperRosterTemplate | undefined
  merged.roster_mode = 'keeper'
  merged.league_type = 'keeper'
  merged.leagueType = 'keeper'
  merged.isKeeper = true
  merged.isDynasty = false
  merged.starter_slots = defaultRosterTemplate?.starterSlots ?? merged.starter_slots
  merged.bench_slots = defaultRosterTemplate?.benchSlots ?? merged.bench_slots
  merged.ir_slots = defaultRosterTemplate?.irSlots ?? merged.ir_slots
  merged.taxi_slots = 0
  merged.taxiSlots = 0
  merged.taxi = false
  merged.taxi_enabled = false
  merged.devy = false
  merged.devy_enabled = false
  merged.c2c = false
  merged.c2c_enabled = false
  merged.dynasty = false
  merged.dynasty_carryover = false
  merged.full_roster_carryover = false
  merged.future_rookie_picks = false
  merged.future_rookie_picks_enabled = false
  merged.future_picks = false
  merged.future_picks_enabled = false
  merged.contracts = false
  merged.contracts_enabled = false
  merged.salary_cap = false
  merged.salary_cap_enabled = false
  merged.rookie_only = false
  merged.rookie_only_pool = false

  merged.keeper_enabled = true
  merged.keepers = true
  merged.keepers_enabled = true
  merged.keeper_carryover_enabled = true
  merged.keeper_max_keepers = keeperMaxKeepers
  merged.keeperMaxKeepers = keeperMaxKeepers
  merged.keeperCount = keeperMaxKeepers
  merged.keeper_max_years = keeperMaxYears
  merged.keeperMaxYears = keeperMaxYears
  merged.keeper_eligibility_rule = 'any'
  merged.keeperEligibilityRule = 'any'
  merged.keeper_cost_system = costSystem
  merged.keeperCostSystem = costSystem
  merged.keeper_round_penalty = keeperRoundPenalty
  merged.keeperRoundPenalty = keeperRoundPenalty
  merged.keeper_auction_pct_increase = safeAuctionPct
  merged.keeperAuctionPctIncrease = safeAuctionPct
  merged.keeper_waiver_allowed = waiverAllowed
  merged.keeperWaiverAllowed = waiverAllowed
  merged.keeper_conflict_rule = 'player_chooses'
  merged.keeperConflictRule = 'player_chooses'
  merged.keeper_missed_deadline_rule = 'auto_no_keepers'
  merged.keeperMissedDeadlineRule = 'auto_no_keepers'
  merged.keeper_declaration_deadline_default = 'before_draft'
  merged.kept_player_round_costs_enabled = !isAuction
  merged.kept_players_removed_from_pool = true
  merged.draft_round_adjustments_enabled = !isAuction
  merged.kept_player_budget_deductions_enabled = isAuction
  merged.roster_needs_account_for_keepers = true

  const nextDraftSettings: KeeperDraftSettings = {
    ...(defaultDraftSettings ?? {}),
    ...draftSettings,
    draftType: engineDraftType,
    requestedDraftType,
    engineCore: engineDraftType,
    rounds,
    fallbackRounds: defaultDraftSettings?.fallbackRounds ?? (defaults.sport === 'NCAAF' ? 20 : rounds),
    timerSeconds,
    slowTimerSeconds: merged.draft_slow_timer_seconds as number,
    pickWindowHours: merged.draft_pick_window_hours as number | null,
    pickOrderRules,
    snakeOrLinear: pickOrderRules,
    sameOrderEveryRound: pickOrderRules === 'linear',
    thirdRoundReversal: false,
    queueSizeLimit,
    autopickBehavior: merged.draft_autopick_behavior as 'queue-first',
    autopickBehaviorAlias: 'queue_first',
    preDraftRankingSource: merged.draft_pre_draft_ranking_source as string,
    rosterFillOrder: merged.draft_roster_fill_order as string,
    positionFilterBehavior: merged.draft_position_filter_behavior as string,
    auctionBudgetPerTeam: isAuction ? 200 : null,
    nominationOrderEnabled: isAuction,
    timerDisabled: requestedDraftType === 'offline',
    slowDraftEnabled: requestedDraftType === 'slow_draft',
    overnightPauseEnabled: requestedDraftType === 'slow_draft',
    remindersEnabled: requestedDraftType === 'slow_draft',
    mockDraftEnabled: requestedDraftType === 'mock_draft',
    usesKeeperSettings: requestedDraftType === 'mock_draft',
    doesNotMutateRealRosters: requestedDraftType === 'mock_draft',
    keeperCostsVisible: isAuction || requestedDraftType === 'mock_draft' || requestedDraftType === 'offline',
    offlineModeEnabled: requestedDraftType === 'offline',
    commissionerPickEntryEnabled: requestedDraftType === 'offline',
    autoDraftEnabled: requestedDraftType === 'auto',
    eligiblePoolExcludesKeepers: true,
    rosterNeedsAccountForKeepers: true,
    teamDraftModeEnabled: requestedDraftType === 'team',
    coManagerControlsEnabled: requestedDraftType === 'team',
    keeperDeclarationPermissionsClear: requestedDraftType === 'team',
  }
  const nextKeeperPolicy: KeeperPolicySettings = {
    ...(defaultKeeperPolicy ?? buildKeeperPolicy(requestedDraftType)),
    maxKeepers: keeperMaxKeepers,
    maxYears: keeperMaxYears,
    costSystem,
    roundPenalty: keeperRoundPenalty,
    auctionPctIncrease: safeAuctionPct,
    waiverAllowed,
    keptPlayerRoundCostsEnabled: !isAuction,
    draftRoundAdjustmentsEnabled: !isAuction,
    keptPlayerBudgetDeductionsEnabled: isAuction,
  }

  merged.draftSettings = nextDraftSettings
  merged.keeperSettings = nextKeeperPolicy
  merged.keeperPolicy = nextKeeperPolicy
  merged.scoringSettings = {
    ...((defaults.scoringSettings as Record<string, unknown> | undefined) ?? {}),
    ...(isRecord(incoming.scoringSettings) ? incoming.scoringSettings : {}),
    preset: resolvedScoringPresetId,
    scoringPresetId: resolvedScoringPresetId,
    scoringTemplateId: defaults.scoring_template_id,
    scoringMode: 'points',
    keeper: true,
    dynasty: false,
  }
  merged.rosterTemplate = defaultRosterTemplate
  merged.rosterSettings = {
    ...((defaults.rosterSettings as Record<string, unknown> | undefined) ?? {}),
    rosterNeedsAccountForKeepers: true,
    keeperSlots: keeperMaxKeepers,
  }
  merged.playerPoolRules = {
    ...(defaults.playerPoolRules as Record<string, unknown> | undefined),
    ...(isRecord(incoming.playerPoolRules) ? incoming.playerPoolRules : {}),
    sport: defaults.sport,
    includeNflPlayers: defaults.sport === 'NFL',
    includeCollegePlayers: defaults.sport === 'NCAAF',
    collegeOnly: defaults.sport === 'NCAAF',
    rookieOnly: false,
    excludeRookieOnlyPool: true,
    keptPlayersRemovedFromPool: true,
    eligiblePoolExcludesKeepers: true,
    rosterNeedsAccountForKeepers: true,
    positions: unique(
      ((defaultRosterTemplate?.draftablePlayerPositions ?? []) as string[]).map((position) => String(position)),
    ),
  }
  merged.player_pool_rules = merged.playerPoolRules
  merged.waiverSettings = {
    ...((defaults.waiverSettings as Record<string, unknown> | undefined) ?? {}),
    ...(isRecord(incoming.waiverSettings) ? incoming.waiverSettings : {}),
    keeperWaiverAllowed: waiverAllowed,
  }
  merged.tradeSettings = {
    ...((defaults.tradeSettings as Record<string, unknown> | undefined) ?? {}),
    ...(isRecord(incoming.tradeSettings) ? incoming.tradeSettings : {}),
    futureRookiePicksEnabled: false,
    tradeCenterEnabled: true,
  }
  merged.devyConfig = { ...(isRecord(incoming.devyConfig) ? incoming.devyConfig : {}), enabled: false }
  merged.c2cConfig = { ...(isRecord(incoming.c2cConfig) ? incoming.c2cConfig : {}), enabled: false }
  merged.salaryCapSettings = { ...(isRecord(incoming.salaryCapSettings) ? incoming.salaryCapSettings : {}), enabled: false }
  merged.contractSettings = { ...(isRecord(incoming.contractSettings) ? incoming.contractSettings : {}), enabled: false }
  merged.tabsEnabled = defaults.tabsEnabled
  merged.tabs_enabled = defaults.tabs_enabled
  merged.mockDraftRules = buildSurfaceRules('mock', nextDraftSettings)
  merged.mock_draft_rules = merged.mockDraftRules
  merged.liveDraftRules = buildSurfaceRules('live', nextDraftSettings)
  merged.live_draft_rules = merged.liveDraftRules

  return merged
}
