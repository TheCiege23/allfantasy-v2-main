/**
 * Canonical dynasty league defaults — single source of truth for NFL and NCAAF
 * dynasty creation. Mirrors the redraftDefaults pattern but enforces dynasty-
 * specific invariants: deeper benches, taxi squad, IR slots, future picks,
 * and dynasty ADP ranking. No devy/C2C leakage into plain dynasty.
 */
import type { LeagueSport } from '@prisma/client'

// ── Types ─────────────────────────────────────────────────────────────────────

export type DynastyEligibleSport = 'NFL' | 'NCAAF'

export const DYNASTY_DRAFT_TYPE_IDS = [
  'snake',
  'linear',
  'auction',
  'slow_draft',
  'mock_draft',
  'offline',
  'auto',
  'team',
  'rookie_draft',
  'supplemental_draft',
  'dispersal_draft',
] as const

export type DynastyDraftType = (typeof DYNASTY_DRAFT_TYPE_IDS)[number]

type EngineDraftType = 'snake' | 'linear' | 'auction'

export interface DynastyRosterTemplate {
  rosterMode: 'dynasty'
  starterSlots: Record<string, number>
  flexDefinitions: Array<{ slotName: string; allowedPositions: string[] }>
  benchSlots: number
  irSlots: number
  taxiSlots: number
  rosterSlots: number
  totalRosterSlots: number
  startupDraftRounds: number
  draftablePlayerPositions: string[]
  defensePosition: 'DST' | 'DEF'
}

export interface DynastyDraftSettings {
  draftType: EngineDraftType
  requestedDraftType: DynastyDraftType
  rounds: number
  timerSeconds: number
  slowTimerSeconds: number
  pickOrderRules: 'snake' | 'linear'
  snakeOrLinear: 'snake' | 'linear'
  thirdRoundReversal: false
  autopickBehavior: 'queue-first'
  autopickBehaviorAlias: 'queue_first'
  queueSizeLimit: number
  preDraftRankingSource: 'dynasty_adp'
  rosterFillOrder: string
  positionFilterBehavior: string
  auctionBudgetPerTeam: number | null
  rookieDraft: {
    rounds: 4
    pickOrder: 'linear'
    enabled: true
  }
  futurePicks: {
    enabled: true
    yearsOut: 3
  }
  keeperDynastyCarryoverSupported: true
}

export interface DynastyDefaultContract {
  sport: DynastyEligibleSport
  league_type: 'dynasty'
  leagueType: 'dynasty'
  draft_type: EngineDraftType
  requested_draft_type: DynastyDraftType
  teams: number
  rounds: number
  timer_seconds: number
  scoring_preset_id: string
  roster_mode: 'dynasty'
  rosterTemplate: DynastyRosterTemplate
  scoringSettings: Record<string, unknown>
  draftSettings: DynastyDraftSettings
  playerPoolRules: Record<string, unknown>
  tabsEnabled: Record<string, true | 'commissioner'>
  enabledFeatures: Record<string, boolean>
}

// ── Roster configs ─────────────────────────────────────────────────────────────

const NFL_DYNASTY_STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 } as const
// No DEF: no college team defense exists to draft and none is scored (see redraftTeamDefenseEnabled).
const NCAAF_DYNASTY_STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1 } as const

const NFL_DYNASTY_ROSTER_CONFIG = {
  starterSlots: NFL_DYNASTY_STARTERS as Record<string, number>,
  benchSlots: 12,
  irSlots: 3,
  taxiSlots: 4,
  defensePosition: 'DST' as const,
  draftablePlayerPositions: ['QB', 'RB', 'WR', 'TE', 'K', 'DST'],
}

const NCAAF_DYNASTY_ROSTER_CONFIG = {
  starterSlots: NCAAF_DYNASTY_STARTERS as Record<string, number>,
  benchSlots: 12,
  irSlots: 2,
  taxiSlots: 4,
  defensePosition: 'DEF' as const,
  draftablePlayerPositions: ['QB', 'RB', 'WR', 'TE', 'K'],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function isDynastyEligibleSport(sport: unknown): sport is DynastyEligibleSport {
  const normalized = String(sport ?? '').trim().toUpperCase()
  return normalized === 'NFL' || normalized === 'NCAAF'
}

function normalizeEngineDraftType(draftType: unknown): EngineDraftType {
  const raw = String(draftType ?? '').trim().toLowerCase()
  if (raw === 'auction') return 'auction'
  if (raw === 'linear') return 'linear'
  return 'snake'
}

function normalizeDynastyDraftType(value: unknown): DynastyDraftType {
  const raw = String(value ?? '').trim().toLowerCase()
  const normalized =
    raw === 'slow' ? 'slow_draft' : raw === 'mock' ? 'mock_draft' : raw
  return (DYNASTY_DRAFT_TYPE_IDS as readonly string[]).includes(normalized)
    ? (normalized as DynastyDraftType)
    : 'snake'
}

function pickOrderForDraftType(draftType: DynastyDraftType): 'snake' | 'linear' {
  return normalizeEngineDraftType(draftType) === 'linear' ? 'linear' : 'snake'
}

function starterCount(slots: Record<string, number>): number {
  return Object.values(slots).reduce((total, n) => total + n, 0)
}

function defaultScoringPresetId(sport: DynastyEligibleSport): string {
  return sport === 'NCAAF' ? 'ncaaf_half_ppr' : 'fb_half_ppr'
}

// ── Builders ──────────────────────────────────────────────────────────────────

function buildRosterTemplate(sport: DynastyEligibleSport): DynastyRosterTemplate {
  const cfg = sport === 'NCAAF' ? NCAAF_DYNASTY_ROSTER_CONFIG : NFL_DYNASTY_ROSTER_CONFIG
  const rosterSlots = starterCount(cfg.starterSlots)
  const startupDraftRounds = rosterSlots + cfg.benchSlots + cfg.taxiSlots
  return {
    rosterMode: 'dynasty',
    starterSlots: cfg.starterSlots,
    flexDefinitions: [{ slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'] }],
    benchSlots: cfg.benchSlots,
    irSlots: cfg.irSlots,
    taxiSlots: cfg.taxiSlots,
    rosterSlots,
    totalRosterSlots: rosterSlots + cfg.benchSlots + cfg.irSlots + cfg.taxiSlots,
    startupDraftRounds,
    draftablePlayerPositions: cfg.draftablePlayerPositions,
    defensePosition: cfg.defensePosition,
  }
}

function buildScoringSettings(
  sport: DynastyEligibleSport,
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
    dynasty: true,
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
  sport: DynastyEligibleSport,
  draftType: DynastyDraftType,
  rosterTemplate: DynastyRosterTemplate,
): DynastyDraftSettings {
  const engineDraftType = normalizeEngineDraftType(draftType)
  const pickOrderRules = pickOrderForDraftType(draftType)
  return {
    draftType: engineDraftType,
    requestedDraftType: draftType,
    rounds: rosterTemplate.startupDraftRounds,
    timerSeconds: 90,
    slowTimerSeconds: 28_800,
    pickOrderRules,
    snakeOrLinear: pickOrderRules,
    thirdRoundReversal: false,
    autopickBehavior: 'queue-first',
    autopickBehaviorAlias: 'queue_first',
    queueSizeLimit: sport === 'NCAAF' ? 80 : 60,
    preDraftRankingSource: 'dynasty_adp',
    rosterFillOrder: 'position_scarcity',
    positionFilterBehavior: 'by_eligibility',
    auctionBudgetPerTeam: engineDraftType === 'auction' ? 200 : null,
    rookieDraft: {
      rounds: 4,
      pickOrder: 'linear',
      enabled: true,
    },
    futurePicks: {
      enabled: true,
      yearsOut: 3,
    },
    keeperDynastyCarryoverSupported: true,
  }
}

function buildPlayerPoolRules(
  sport: DynastyEligibleSport,
  rosterTemplate: DynastyRosterTemplate,
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
      rankingSource: 'dynasty_adp',
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
    excludeRookieOnlyPool: true,
    positions,
    positionAliases: { DST: ['DEF'] },
    rankingSource: 'dynasty_adp',
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
    mock_draft: true,
    live_draft: true,
    waivers: true,
    trades: true,
    settings: 'commissioner',
  }
}

function buildEnabledFeatures(): Record<string, boolean> {
  return {
    taxi: true,
    taxi_enabled: true,
    future_picks: true,
    future_picks_enabled: true,
    rookie_draft: true,
    keeper_carryover: true,
    keeper_dynasty_carryover_supported: true,
    devy: false,
    devy_enabled: false,
    c2c: false,
    c2c_enabled: false,
    contracts: false,
    salary_cap: false,
    salary_cap_enabled: false,
    isDynasty: true,
    isRedraft: false,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getDynastyDefaultContract(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): DynastyDefaultContract | null {
  const normalizedSport = String(input.sport ?? '').trim().toUpperCase()
  if (!isDynastyEligibleSport(normalizedSport)) return null

  const sport = normalizedSport
  const requestedDraftType = normalizeDynastyDraftType(input.draftType)
  const rosterTemplate = buildRosterTemplate(sport)
  const draftSettings = buildDraftSettings(sport, requestedDraftType, rosterTemplate)
  const scoringPresetId =
    typeof input.scoringPresetId === 'string' && input.scoringPresetId.trim()
      ? input.scoringPresetId.trim()
      : defaultScoringPresetId(sport)
  const scoringSettings = buildScoringSettings(sport, scoringPresetId)
  const playerPoolRules = buildPlayerPoolRules(sport, rosterTemplate)
  const tabsEnabled = buildTabsEnabled()
  const enabledFeatures = buildEnabledFeatures()
  const teamCount = typeof input.teamCount === 'number' && input.teamCount > 0 ? Math.floor(input.teamCount) : 12

  return {
    sport,
    league_type: 'dynasty',
    leagueType: 'dynasty',
    draft_type: draftSettings.draftType,
    requested_draft_type: requestedDraftType,
    teams: teamCount,
    rounds: draftSettings.rounds,
    timer_seconds: draftSettings.timerSeconds,
    scoring_preset_id: scoringPresetId,
    roster_mode: 'dynasty',
    rosterTemplate,
    scoringSettings,
    draftSettings,
    playerPoolRules,
    tabsEnabled,
    enabledFeatures,
  }
}

export function buildDynastySettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): Record<string, unknown> | null {
  const contract = getDynastyDefaultContract(input)
  if (!contract) return null

  const { draftSettings, rosterTemplate } = contract
  return {
    dynastyDefaultsVersion: 1,
    sport: contract.sport,
    sport_type: contract.sport,
    leagueType: 'dynasty',
    league_type: 'dynasty',
    roster_mode: 'dynasty',
    isDynasty: true,
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
    draft_slow_timer_seconds: draftSettings.slowTimerSeconds,
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
    roster_size: rosterTemplate.startupDraftRounds,
    rosterSize: rosterTemplate.startupDraftRounds,
    starter_slots: rosterTemplate.starterSlots,
    bench_slots: rosterTemplate.benchSlots,
    ir_slots: rosterTemplate.irSlots,
    taxi_slots: rosterTemplate.taxiSlots,
    taxiSlots: rosterTemplate.taxiSlots,
    rosterTemplate,
    rosterSettings: {
      rosterMode: 'dynasty',
      starterSlots: rosterTemplate.starterSlots,
      flexDefinitions: rosterTemplate.flexDefinitions,
      benchSlots: rosterTemplate.benchSlots,
      irSlots: rosterTemplate.irSlots,
      taxiSlots: rosterTemplate.taxiSlots,
      rosterSlots: rosterTemplate.rosterSlots,
      rosterSize: rosterTemplate.startupDraftRounds,
      startupDraftRounds: rosterTemplate.startupDraftRounds,
      draftablePlayerPositions: rosterTemplate.draftablePlayerPositions,
    },
    scoringSettings: contract.scoringSettings,
    draftSettings,
    playerPoolRules: contract.playerPoolRules,
    player_pool_rules: contract.playerPoolRules,
    player_pool: contract.playerPoolRules.poolKey,
    tabsEnabled: contract.tabsEnabled,
    tabs_enabled: contract.tabsEnabled,
    ...contract.enabledFeatures,
    rookieDraftConfig: draftSettings.rookieDraft,
    futurePicksConfig: draftSettings.futurePicks,
    keeperDynastyCarryoverSupported: true,
    devyConfig: { enabled: false },
    c2cConfig: { enabled: false },
    keeperSettings: { enabled: false },
    salaryCapSettings: { enabled: false },
    contractSettings: { enabled: false },
  }
}

export function normalizeDynastySettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
  settings?: Record<string, unknown> | null
}): Record<string, unknown> {
  const incoming = input.settings ?? {}
  const requestedDraftType = normalizeDynastyDraftType(
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
    buildDynastySettingsSnapshot({
      sport: input.sport,
      draftType: requestedDraftType,
      scoringPresetId,
      teamCount,
    }) ?? {}

  const merged: Record<string, unknown> = { ...defaults, ...incoming }

  // Enforce dynasty invariants — cannot be overridden by user
  merged.league_type = 'dynasty'
  merged.leagueType = 'dynasty'
  merged.roster_mode = 'dynasty'
  merged.isDynasty = true
  merged.isRedraft = false

  // Enforce no devy/C2C leakage into plain dynasty
  merged.devy = false
  merged.devy_enabled = false
  merged.c2c = false
  merged.c2c_enabled = false
  merged.devyConfig = { ...(typeof incoming.devyConfig === 'object' && incoming.devyConfig !== null ? incoming.devyConfig as object : {}), enabled: false }
  merged.c2cConfig = { ...(typeof incoming.c2cConfig === 'object' && incoming.c2cConfig !== null ? incoming.c2cConfig as object : {}), enabled: false }

  // Enforce taxi / future picks / keeper carryover
  merged.taxi = true
  merged.taxi_enabled = true
  merged.future_picks = true
  merged.future_picks_enabled = true
  merged.keeper_dynasty_carryover_supported = true
  merged.keeperDynastyCarryoverSupported = true

  // Preserve user-supplied league name / language / timezone
  if (typeof incoming.leagueName === 'string') merged.leagueName = incoming.leagueName
  if (typeof incoming.language === 'string') merged.language = incoming.language
  if (typeof incoming.timezone === 'string') merged.timezone = incoming.timezone

  return merged
}
