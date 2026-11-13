/**
 * Salary Cap League — canonical Phase 1 defaults (NFL + NCAAF).
 *
 * Follows the same pattern as redraftDefaults / dynastyDefaults / keeperDefaults.
 * Provides:
 *   - getSalaryCapDefaultContract()       — typed full contract
 *   - buildSalaryCapSettingsSnapshot()    — settings blob for League.settings
 *   - normalizeSalaryCapSettingsSnapshot() — idempotent normalizer (merge path)
 *   - isSalaryCapEligibleSport()
 *   - SALARY_CAP_DRAFT_TYPE_IDS
 *   - validateSalaryCapStructure()
 *
 * Salary cap leagues are ALWAYS auction. The SalaryCapLeagueConfig DB row is
 * created separately by upsertSalaryCapConfig (lib/salary-cap/SalaryCapLeagueConfig).
 * This file seeds League.settings only.
 *
 * Phase 2 contract/ledger automation is pending; all contract-system statuses
 * are explicitly set to 'pending' below.
 */

import type { LeagueSport } from '@prisma/client'

// ── Sport eligibility ─────────────────────────────────────────────────────────

type SalaryCapSport = 'NFL' | 'NCAAF'

export function isSalaryCapEligibleSport(sport: unknown): sport is SalaryCapSport {
  const s = String(sport ?? '').trim().toUpperCase()
  return s === 'NFL' || s === 'NCAAF'
}

// ── Draft type support ────────────────────────────────────────────────────────

/**
 * Salary cap is auction-only. Snake/linear drafts are not permitted.
 * Auto, offline, and mock are accepted supplementary modes.
 */
type SalaryCapDraftType = 'auction' | 'auto' | 'offline' | 'mock_draft'

export const SALARY_CAP_DRAFT_TYPE_IDS: readonly SalaryCapDraftType[] = [
  'auction',
  'auto',
  'offline',
  'mock_draft',
] as const

export function normalizeSalaryCapDraftType(value: unknown): SalaryCapDraftType {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'mock_draft' || raw === 'mock') return 'mock_draft'
  if (raw === 'offline') return 'offline'
  if (raw === 'auto') return 'auto'
  if (raw === 'auction') return 'auction'
  // snake / linear are not valid for salary cap — reject to auction
  return 'auction'
}

// ── Sport-aware constants ─────────────────────────────────────────────────────

const NFL_STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 } as const
const NCAAF_STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 } as const

function defaultScoringPresetId(sport: SalaryCapSport): string {
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

function scoringTemplateId(sport: SalaryCapSport, presetId: string): string {
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

function scoringAliasesForPreset(sport: SalaryCapSport, presetId: string): string[] {
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

function starterCount(starters: Record<string, number>): number {
  return Object.values(starters).reduce((t, n) => t + n, 0)
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ── Sub-types ─────────────────────────────────────────────────────────────────

interface SalaryCapRosterTemplate {
  rosterMode: 'salary_cap'
  starterSlots: Record<string, number>
  flexDefinitions: Array<{ slotName: string; allowedPositions: string[] }>
  benchSlots: number
  irSlots: number
  taxiSlots: 0
  rosterSlots: number
  draftableRosterSlots: number
  totalRosterSlots: number
  rosterPositions: string[]
  draftablePlayerPositions: string[]
  defensePosition: 'DST' | 'DEF'
}

interface SalaryCapDraftSettings {
  draftType: 'auction'
  requestedDraftType: SalaryCapDraftType
  engineCore: 'auction'
  auctionBudgetPerTeam: number
  nominationOrderEnabled: true
  bidValidationEnabled: true
  minBidEqualsMinSalary: true
  maxBidValidatesAgainstMaxSalary: true
  auctionResultCreatesContractRecord: boolean
  timerSeconds: number
  slowTimerSeconds: number
  autopickBehavior: 'queue-first'
  autopickBehaviorAlias: 'queue_first'
  queueSizeLimit: number
  preDraftRankingSource: string
  rosterFillOrder: string
  positionFilterBehavior: string
  salaryValuesVisible: true
  capSpaceRemainingVisible: true
  timerDisabled: boolean
  mockDraftEnabled: boolean
  doesNotMutateRealSalaries: boolean
  offlineModeEnabled: boolean
  commissionerBidEntryEnabled: boolean
  autoDraftEnabled: boolean
  budgetValidationEnabled: true
  mockAuctionBudgetValidationEnabled: true
}

interface SalaryCapCapPolicy {
  salaryCapEnabled: true
  capPhase: 'setup'
  totalCap: number
  auctionBudgetPerTeam: number
  maxSalary: number
  minSalary: number
  salaryCurve: 'linear' | 'balanced'
  defaultContractYears: number
  maxContractYears: number
  capGrowthPercent: number
  auctionHoldback: number
  franchiseTagEnabled: boolean
  franchiseTagLimit: number
  deadMoneyEnabled: boolean
  deadMoneyPct: number
  capRolloverEnabled: boolean
  capRolloverMax: number
  capFloorEnabled: boolean
  capFloorPct: number
  contractExtensionsEnabled: boolean
  releasePenaltiesEnabled: boolean
  tradeCapValidationEnabled: boolean
  commissionerCapOverrideEnabled: true
  // Automation statuses
  contractSystemStatus: 'pending'
  salaryLedgerStatus: 'pending'
  deadMoneyLedgerStatus: 'pending'
  contractExtensionStatus: 'pending'
  franchiseTagStatus: 'pending'
  offseasonPhase: 'setup'
}

interface SalaryCapDefaultContract {
  sport: SalaryCapSport
  league_type: 'salary_cap'
  leagueType: 'salary_cap'
  draft_type: 'auction'
  requested_draft_type: SalaryCapDraftType
  teams: number
  timer_seconds: number
  scoring_preset_id: string
  scoringPresetAliases: string[]
  roster_mode: 'salary_cap'
  rosterTemplate: SalaryCapRosterTemplate
  scoringSettings: Record<string, unknown>
  waiverSettings: Record<string, unknown>
  tradeSettings: Record<string, unknown>
  draftSettings: SalaryCapDraftSettings
  capPolicy: SalaryCapCapPolicy
  playerPoolRules: Record<string, unknown>
  tabsEnabled: Record<string, true | 'commissioner' | 'pending'>
  mockDraftRules: Record<string, unknown>
  liveDraftRules: Record<string, unknown>
  disabledSettings: Record<string, boolean>
  validationErrors: string[]
}

// ── Builders ──────────────────────────────────────────────────────────────────

function buildRosterTemplate(sport: SalaryCapSport): SalaryCapRosterTemplate {
  const starterSlots = sport === 'NCAAF' ? { ...NCAAF_STARTERS } : { ...NFL_STARTERS }
  const defensePosition = sport === 'NCAAF' ? 'DEF' : 'DST'
  const rosterPositions = Object.keys(starterSlots)
  const draftablePlayerPositions =
    sport === 'NCAAF'
      ? ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
      : ['QB', 'RB', 'WR', 'TE', 'K', 'DST']
  const benchSlots = 7
  const irSlots = 2
  const rosterSlots = starterCount(starterSlots)
  return {
    rosterMode: 'salary_cap',
    starterSlots,
    flexDefinitions: [{ slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'] }],
    benchSlots,
    irSlots,
    taxiSlots: 0,
    rosterSlots,
    draftableRosterSlots: rosterSlots + benchSlots,
    totalRosterSlots: rosterSlots + benchSlots + irSlots,
    rosterPositions,
    draftablePlayerPositions,
    defensePosition,
  }
}

function buildScoringSettings(
  sport: SalaryCapSport,
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
    keeper: false,
    dynasty: false,
    salary_cap: true,
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

function buildCapPolicy(sport: SalaryCapSport): SalaryCapCapPolicy {
  const isNcaaf = sport === 'NCAAF'
  return {
    salaryCapEnabled: true,
    capPhase: 'setup',
    totalCap: 200,
    auctionBudgetPerTeam: 200,
    maxSalary: 100,
    minSalary: 1,
    salaryCurve: 'linear',
    defaultContractYears: 1,
    maxContractYears: isNcaaf ? 3 : 4,
    capGrowthPercent: isNcaaf ? 0 : 5,
    auctionHoldback: 50,
    franchiseTagEnabled: !isNcaaf,
    franchiseTagLimit: isNcaaf ? 0 : 1,
    deadMoneyEnabled: !isNcaaf,   // disabled for NCAAF pending contract system
    deadMoneyPct: 0.5,
    capRolloverEnabled: !isNcaaf, // NCAAF cap resets each season
    capRolloverMax: isNcaaf ? 0 : 25,
    capFloorEnabled: true,
    capFloorPct: 0.75,
    contractExtensionsEnabled: false,
    releasePenaltiesEnabled: !isNcaaf,
    tradeCapValidationEnabled: true,
    commissionerCapOverrideEnabled: true,
    // All contract-system automation is pending Phase 2
    contractSystemStatus: 'pending',
    salaryLedgerStatus: 'pending',
    deadMoneyLedgerStatus: 'pending',
    contractExtensionStatus: 'pending',
    franchiseTagStatus: 'pending',
    offseasonPhase: 'setup',
  }
}

function buildDraftSettings(
  sport: SalaryCapSport,
  draftType: SalaryCapDraftType,
  capPolicy: SalaryCapCapPolicy,
): SalaryCapDraftSettings {
  const isMock = draftType === 'mock_draft'
  const isOffline = draftType === 'offline'
  const isAuto = draftType === 'auto'
  return {
    draftType: 'auction',
    requestedDraftType: draftType,
    engineCore: 'auction',
    auctionBudgetPerTeam: capPolicy.totalCap,
    nominationOrderEnabled: true,
    bidValidationEnabled: true,
    minBidEqualsMinSalary: true,
    maxBidValidatesAgainstMaxSalary: true,
    auctionResultCreatesContractRecord: false, // pending Phase 2
    timerSeconds: 90,
    slowTimerSeconds: 28_800,
    autopickBehavior: 'queue-first',
    autopickBehaviorAlias: 'queue_first',
    queueSizeLimit: sport === 'NCAAF' ? 70 : 60,
    preDraftRankingSource:
      sport === 'NCAAF' ? 'ncaaf_auction_values_adp_fallback' : 'auction_values_adp_fallback',
    rosterFillOrder: 'position_scarcity',
    positionFilterBehavior: 'by_eligibility',
    salaryValuesVisible: true,
    capSpaceRemainingVisible: true,
    timerDisabled: isOffline,
    mockDraftEnabled: isMock,
    doesNotMutateRealSalaries: isMock,
    offlineModeEnabled: isOffline,
    commissionerBidEntryEnabled: isOffline,
    autoDraftEnabled: isAuto,
    budgetValidationEnabled: true,
    mockAuctionBudgetValidationEnabled: true,
  }
}

function buildPlayerPoolRules(
  sport: SalaryCapSport,
  rosterTemplate: SalaryCapRosterTemplate,
): Record<string, unknown> {
  const positions = rosterTemplate.draftablePlayerPositions
  const common = {
    includeActiveOnly: true,
    rookieOnly: false,
    positions,
    capPoolOnly: true,
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
      rankingSource: 'ncaaf_auction_values_adp_fallback',
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
    rankingSource: 'auction_values_adp_fallback',
  }
}

function buildWaiverSettings(): Record<string, unknown> {
  return {
    waiverType: 'faab',
    faabBudget: 100,
    processingDays: [2],
    processingTimeUtc: '10:00',
    capWaiverValidationEnabled: true,
    freeAgentUnlockBehavior: 'after_waiver_run',
    gameLockBehavior: 'game_time',
  }
}

function buildTradeSettings(): Record<string, unknown> {
  return {
    tradeCenterEnabled: true,
    tradeReviewMode: 'commissioner',
    futureRookiePicksEnabled: false,
    capValidationOnTrades: true,
    tradeCapValidationStatus: 'pending',
  }
}

function buildTabsEnabled(
  draftType: SalaryCapDraftType,
): Record<string, true | 'commissioner' | 'pending'> {
  const isMock = draftType === 'mock_draft'
  return {
    overview: true,
    teams: true,
    rosters: true,
    roster: true,
    salary_cap: true,
    contracts: 'pending',
    auction_draft: true,
    mock_auction: isMock ? true : 'pending',
    standings: true,
    matchups: true,
    schedule: true,
    waivers: true,
    free_agents: true,
    trade_center: true,
    trades: true,
    settings: 'commissioner',
    commissioner_tools: 'commissioner',
  }
}

function buildDisabledSettings(): Record<string, boolean> {
  return {
    taxi: false,
    taxi_enabled: false,
    taxiSlots: false,
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
    keeper_enabled: false,
    keeper: false,
    best_ball: false,
    best_ball_enabled: false,
    guillotine: false,
    guillotine_enabled: false,
    survivor: false,
    survivor_enabled: false,
    tournament: false,
    tournament_enabled: false,
    isDynasty: false,
  }
}

function buildMockDraftRules(
  draftSettings: SalaryCapDraftSettings,
): Record<string, unknown> {
  return {
    enabled: draftSettings.mockDraftEnabled,
    surface: 'mock',
    draftType: 'auction',
    requestedDraftType: draftSettings.requestedDraftType,
    auctionBudgetPerTeam: draftSettings.auctionBudgetPerTeam,
    budgetValidationEnabled: draftSettings.mockAuctionBudgetValidationEnabled,
    doesNotMutateRealSalaries: true,
    doesNotMutateRealRosters: true,
    doesNotMutateContractLedger: true,
    salaryValuesVisible: true,
    capSpaceRemainingVisible: true,
    usesSameDraftSettings: true,
  }
}

function buildLiveDraftRules(
  draftSettings: SalaryCapDraftSettings,
): Record<string, unknown> {
  return {
    enabled: true,
    surface: 'live',
    draftType: 'auction',
    requestedDraftType: draftSettings.requestedDraftType,
    auctionBudgetPerTeam: draftSettings.auctionBudgetPerTeam,
    bidValidationEnabled: true,
    nominationOrderEnabled: true,
    capSpaceRemainingVisible: true,
    salaryValuesVisible: true,
    bidValidatesAgainstCap: true,
    minBid: 1,
    maxBidValidatesAgainstMaxSalary: true,
    offlineModeEnabled: draftSettings.offlineModeEnabled,
    commissionerBidEntryEnabled: draftSettings.commissionerBidEntryEnabled,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getSalaryCapDefaultContract(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): SalaryCapDefaultContract | null {
  const normalizedSport = String(input.sport ?? '').trim().toUpperCase()
  if (!isSalaryCapEligibleSport(normalizedSport)) return null

  const sport = normalizedSport
  const requestedDraftType = normalizeSalaryCapDraftType(input.draftType)
  const scoringPresetId =
    typeof input.scoringPresetId === 'string' && input.scoringPresetId.trim()
      ? input.scoringPresetId.trim()
      : defaultScoringPresetId(sport)

  const rosterTemplate = buildRosterTemplate(sport)
  const capPolicy = buildCapPolicy(sport)
  const draftSettings = buildDraftSettings(sport, requestedDraftType, capPolicy)
  const scoringSettings = buildScoringSettings(sport, scoringPresetId)
  const playerPoolRules = buildPlayerPoolRules(sport, rosterTemplate)
  const tabsEnabled = buildTabsEnabled(requestedDraftType)
  const disabledSettings = buildDisabledSettings()
  const mockDraftRules = buildMockDraftRules(draftSettings)
  const liveDraftRules = buildLiveDraftRules(draftSettings)

  const validationErrors: string[] = []
  if (capPolicy.maxSalary > capPolicy.totalCap) {
    validationErrors.push('maxSalary must not exceed totalCap')
  }
  if (capPolicy.minSalary < 1) {
    validationErrors.push('minSalary must be at least 1')
  }
  if (capPolicy.maxContractYears < capPolicy.defaultContractYears) {
    validationErrors.push('maxContractYears must be >= defaultContractYears')
  }

  return {
    sport,
    league_type: 'salary_cap',
    leagueType: 'salary_cap',
    draft_type: 'auction',
    requested_draft_type: requestedDraftType,
    teams: asPositiveInt(input.teamCount, 12),
    timer_seconds: draftSettings.timerSeconds,
    scoring_preset_id: scoringPresetId,
    scoringPresetAliases: scoringAliasesForPreset(sport, scoringPresetId),
    roster_mode: 'salary_cap',
    rosterTemplate,
    scoringSettings,
    waiverSettings: buildWaiverSettings(),
    tradeSettings: buildTradeSettings(),
    draftSettings,
    capPolicy,
    playerPoolRules,
    tabsEnabled,
    mockDraftRules,
    liveDraftRules,
    disabledSettings,
    validationErrors,
  }
}

export function buildSalaryCapSettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): Record<string, unknown> | null {
  const contract = getSalaryCapDefaultContract(input)
  if (!contract) return null

  const { draftSettings, capPolicy, rosterTemplate } = contract
  return {
    salaryCapDefaultsVersion: 1,
    sport: contract.sport,
    sport_type: contract.sport,
    leagueType: 'salary_cap',
    league_type: 'salary_cap',
    roster_mode: 'salary_cap',
    isSalaryCap: true,
    salary_cap_enabled: true,
    salary_cap_mode: 'salary_cap',
    cap_phase: capPolicy.capPhase,
    teams: contract.teams,
    default_team_count: contract.teams,
    scoring_preset_id: contract.scoring_preset_id,
    scoringPreset: contract.scoring_preset_id,
    scoringPresetAliases: contract.scoringPresetAliases,
    scoring_mode: 'points',
    scoring_format: contract.scoringSettings.scoringFormat,
    scoring_template_id: contract.scoringSettings.scoringTemplateId,
    // Draft
    draft_type: 'auction',
    requested_draft_type: draftSettings.requestedDraftType,
    draft_engine_core: 'auction',
    draft_timer_seconds: draftSettings.timerSeconds,
    draft_slow_timer_seconds: draftSettings.slowTimerSeconds,
    draft_autopick_behavior: draftSettings.autopickBehavior,
    draft_autopick_behavior_alias: draftSettings.autopickBehaviorAlias,
    draft_queue_size_limit: draftSettings.queueSizeLimit,
    queue_size_limit: draftSettings.queueSizeLimit,
    draft_pre_draft_ranking_source: draftSettings.preDraftRankingSource,
    draft_roster_fill_order: draftSettings.rosterFillOrder,
    draft_position_filter_behavior: draftSettings.positionFilterBehavior,
    // Auction
    auction_budget_per_team: capPolicy.auctionBudgetPerTeam,
    auctionBudgetPerTeam: capPolicy.auctionBudgetPerTeam,
    nomination_order_enabled: draftSettings.nominationOrderEnabled,
    bid_validation_enabled: draftSettings.bidValidationEnabled,
    min_bid_equals_min_salary: draftSettings.minBidEqualsMinSalary,
    max_bid_validates_against_max_salary: draftSettings.maxBidValidatesAgainstMaxSalary,
    salary_values_visible: draftSettings.salaryValuesVisible,
    cap_space_remaining_visible: draftSettings.capSpaceRemainingVisible,
    timer_disabled: draftSettings.timerDisabled,
    mock_draft_enabled: draftSettings.mockDraftEnabled,
    offline_mode_enabled: draftSettings.offlineModeEnabled,
    commissioner_bid_entry_enabled: draftSettings.commissionerBidEntryEnabled,
    auto_draft_enabled: draftSettings.autoDraftEnabled,
    budget_validation_enabled: draftSettings.budgetValidationEnabled,
    // Roster
    roster_size: rosterTemplate.draftableRosterSlots,
    rosterSize: rosterTemplate.draftableRosterSlots,
    starter_slots: rosterTemplate.starterSlots,
    bench_slots: rosterTemplate.benchSlots,
    ir_slots: rosterTemplate.irSlots,
    taxi_slots: 0,
    rosterTemplate,
    rosterSettings: {
      rosterMode: 'salary_cap',
      starterSlots: rosterTemplate.starterSlots,
      flexDefinitions: rosterTemplate.flexDefinitions,
      benchSlots: rosterTemplate.benchSlots,
      irSlots: rosterTemplate.irSlots,
      taxiSlots: 0,
      rosterSlots: rosterTemplate.rosterSlots,
      rosterSize: rosterTemplate.draftableRosterSlots,
      rosterPositions: rosterTemplate.rosterPositions,
      draftablePlayerPositions: rosterTemplate.draftablePlayerPositions,
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
    // Salary cap settings
    total_cap: capPolicy.totalCap,
    totalCap: capPolicy.totalCap,
    salary_cap_startup_cap: capPolicy.totalCap,
    max_salary: capPolicy.maxSalary,
    maxSalary: capPolicy.maxSalary,
    min_salary: capPolicy.minSalary,
    minSalary: capPolicy.minSalary,
    salary_curve: capPolicy.salaryCurve,
    salaryCurve: capPolicy.salaryCurve,
    default_contract_years: capPolicy.defaultContractYears,
    defaultContractYears: capPolicy.defaultContractYears,
    max_contract_years: capPolicy.maxContractYears,
    maxContractYears: capPolicy.maxContractYears,
    cap_growth_percent: capPolicy.capGrowthPercent,
    capGrowthPercent: capPolicy.capGrowthPercent,
    auction_holdback: capPolicy.auctionHoldback,
    // Franchise tag
    franchise_tag_enabled: capPolicy.franchiseTagEnabled,
    franchiseTagEnabled: capPolicy.franchiseTagEnabled,
    franchise_tag_limit: capPolicy.franchiseTagLimit,
    // Dead money
    dead_money_enabled: capPolicy.deadMoneyEnabled,
    deadMoneyEnabled: capPolicy.deadMoneyEnabled,
    dead_money_pct: capPolicy.deadMoneyPct,
    deadMoneyPct: capPolicy.deadMoneyPct,
    // Cap rollover
    cap_rollover_enabled: capPolicy.capRolloverEnabled,
    capRolloverEnabled: capPolicy.capRolloverEnabled,
    cap_rollover_max: capPolicy.capRolloverMax,
    capRolloverMax: capPolicy.capRolloverMax,
    // Cap floor
    cap_floor_enabled: capPolicy.capFloorEnabled,
    capFloorEnabled: capPolicy.capFloorEnabled,
    cap_floor_pct: capPolicy.capFloorPct,
    capFloorPct: capPolicy.capFloorPct,
    // Contract/release
    contract_extensions_enabled: capPolicy.contractExtensionsEnabled,
    contractExtensionsEnabled: capPolicy.contractExtensionsEnabled,
    release_penalties_enabled: capPolicy.releasePenaltiesEnabled,
    releasePenaltiesEnabled: capPolicy.releasePenaltiesEnabled,
    trade_cap_validation_enabled: capPolicy.tradeCapValidationEnabled,
    tradeCapValidationEnabled: capPolicy.tradeCapValidationEnabled,
    commissioner_cap_override_enabled: capPolicy.commissionerCapOverrideEnabled,
    // Automation statuses — all pending Phase 2
    contract_system_status: capPolicy.contractSystemStatus,
    salary_ledger_status: capPolicy.salaryLedgerStatus,
    dead_money_ledger_status: capPolicy.deadMoneyLedgerStatus,
    contract_extension_status: capPolicy.contractExtensionStatus,
    franchise_tag_status: capPolicy.franchiseTagStatus,
    offseason_phase: capPolicy.offseasonPhase,
    capPolicy,
    // Guardrails — explicitly disabled
    ...contract.disabledSettings,
    devyConfig: { enabled: false },
    c2cConfig: { enabled: false },
    keeperSettings: { enabled: false },
    survivorConfig: { enabled: false },
    guillotineConfig: { enabled: false },
    tournamentConfig: { enabled: false },
    bestBallConfig: { enabled: false },
    validationErrors: contract.validationErrors,
  }
}

export function normalizeSalaryCapSettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
  settings?: Record<string, unknown> | null
}): Record<string, unknown> {
  const incoming = input.settings ?? {}
  const requestedDraftType = normalizeSalaryCapDraftType(
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
    buildSalaryCapSettingsSnapshot({
      sport: input.sport,
      draftType: requestedDraftType,
      scoringPresetId,
      teamCount,
    }) ?? {}

  const merged: Record<string, unknown> = { ...defaults, ...incoming }

  // Hard-enforce salary cap draft type (never allow snake/linear)
  merged.draft_type = 'auction'
  merged.requested_draft_type = requestedDraftType
  merged.draft_engine_core = 'auction'
  merged.leagueType = 'salary_cap'
  merged.league_type = 'salary_cap'
  merged.isSalaryCap = true
  merged.salary_cap_enabled = true

  // Clamp numeric cap fields
  const defaultCapPolicy = (defaults.capPolicy as SalaryCapCapPolicy | undefined) ?? buildCapPolicy(
    isSalaryCapEligibleSport(input.sport) ? input.sport : 'NFL',
  )

  const totalCap = clampInt(
    merged.total_cap ?? merged.totalCap ?? merged.salary_cap_startup_cap,
    defaultCapPolicy.totalCap,
    1,
    10_000,
  )
  const maxSalary = clampInt(
    merged.max_salary ?? merged.maxSalary,
    Math.min(defaultCapPolicy.maxSalary, totalCap),
    1,
    totalCap,
  )
  const minSalary = clampInt(merged.min_salary ?? merged.minSalary, 1, 1, maxSalary)
  const maxContractYears = clampInt(
    merged.max_contract_years ?? merged.maxContractYears,
    defaultCapPolicy.maxContractYears,
    1,
    10,
  )
  const defaultContractYears = clampInt(
    merged.default_contract_years ?? merged.defaultContractYears,
    1,
    1,
    maxContractYears,
  )

  merged.total_cap = totalCap
  merged.totalCap = totalCap
  merged.salary_cap_startup_cap = totalCap
  merged.auction_budget_per_team = totalCap
  merged.auctionBudgetPerTeam = totalCap
  merged.max_salary = maxSalary
  merged.maxSalary = maxSalary
  merged.min_salary = minSalary
  merged.minSalary = minSalary
  merged.max_contract_years = maxContractYears
  merged.maxContractYears = maxContractYears
  merged.default_contract_years = defaultContractYears
  merged.defaultContractYears = defaultContractYears

  // Automation statuses stay pending (Phase 2)
  merged.contract_system_status = 'pending'
  merged.salary_ledger_status = 'pending'
  merged.dead_money_ledger_status = 'pending'
  merged.contract_extension_status = 'pending'
  merged.franchise_tag_status = 'pending'

  // Guardrails — always disabled
  merged.dynasty = false
  merged.dynasty_carryover = false
  merged.keeper_enabled = false
  merged.devy = false
  merged.c2c = false
  merged.taxi = false
  merged.best_ball = false
  merged.guillotine = false
  merged.survivor = false
  merged.tournament = false

  return merged
}

// ── Validation helper ─────────────────────────────────────────────────────────

export function validateSalaryCapStructure(settings: Record<string, unknown>): string[] {
  const errors: string[] = []
  const totalCap = Number(settings.total_cap ?? settings.totalCap ?? 0)
  const maxSalary = Number(settings.max_salary ?? settings.maxSalary ?? 0)
  const minSalary = Number(settings.min_salary ?? settings.minSalary ?? 0)
  const maxYears = Number(settings.max_contract_years ?? settings.maxContractYears ?? 0)
  const defaultYears = Number(settings.default_contract_years ?? settings.defaultContractYears ?? 1)
  const draftType = String(settings.draft_type ?? settings.requested_draft_type ?? '').toLowerCase()

  if (totalCap < 1) errors.push('total_cap must be at least 1')
  if (maxSalary < 1) errors.push('max_salary must be at least 1')
  if (minSalary < 1) errors.push('min_salary must be at least 1')
  if (maxSalary > totalCap) errors.push('max_salary must not exceed total_cap')
  if (minSalary > maxSalary) errors.push('min_salary must not exceed max_salary')
  if (maxYears < 1) errors.push('max_contract_years must be at least 1')
  if (defaultYears > maxYears) errors.push('default_contract_years must not exceed max_contract_years')
  if (draftType === 'snake' || draftType === 'linear') {
    errors.push('salary_cap leagues must use auction draft type, not snake/linear')
  }
  const sport = String(settings.sport ?? settings.sport_type ?? '')
  if (sport === 'NFL' && settings.player_pool === 'ncaaf_active_college_fantasy_players') {
    errors.push('NFL salary cap must not use NCAAF player pool')
  }
  if (sport === 'NCAAF' && settings.player_pool === 'nfl_active_fantasy_players') {
    errors.push('NCAAF salary cap must not use NFL player pool')
  }
  return errors
}
