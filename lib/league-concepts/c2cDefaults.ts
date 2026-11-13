/**
 * Campus-to-Canton (C2C) League — canonical Phase 1 defaults (NFL + NCAAF).
 *
 * Follows the same pattern as devyDefaults / dynastyDefaults / keeperDefaults.
 * C2C is a two-track league: a pro/canton roster (NFL players) and a campus
 * roster (NCAAF players) that eventually graduate into the pro pool.
 *
 * Sport mapping:
 *   sport=NFL  → pro=NFL, campus=NCAAF  (primary C2C format, fully supported)
 *   sport=NCAAF → same nfl_c2c adapter, campus-first view  (also supported)
 *
 * Phase 2 automation (promotion engine, hybrid standings, graduated-player
 * processing, merged startup draft) is explicitly pending below.
 *
 * Provides:
 *   - getC2CDefaultContract()
 *   - buildC2CSettingsSnapshot()
 *   - normalizeC2CSettingsSnapshot()
 *   - isC2CEligibleSport()
 *   - C2C_DRAFT_TYPE_IDS
 *   - validateC2CStructure()
 */

import type { LeagueSport } from '@prisma/client'
import {
  NFL_C2C_PRO_LINEUP_DEFAULT,
  NFL_C2C_COLLEGE_LINEUP_DEFAULT,
  NFL_C2C_PRO_BENCH,
  NFL_C2C_PRO_IR,
  NFL_C2C_TAXI,
  NFL_C2C_COLLEGE_ROSTER_SIZE,
  NFL_C2C_ROOKIE_DRAFT_ROUNDS,
  NFL_C2C_COLLEGE_DRAFT_ROUNDS,
  NFL_C2C_COLLEGE_POSITIONS,
} from '@/lib/merged-devy-c2c/constants'
import { getC2CAdapterForSport } from '@/lib/merged-devy-c2c/types'

// ── Sport eligibility ─────────────────────────────────────────────────────────

type C2CSport = 'NFL' | 'NCAAF'

export function isC2CEligibleSport(sport: unknown): sport is C2CSport {
  const s = String(sport ?? '').trim().toUpperCase()
  return s === 'NFL' || s === 'NCAAF'
}

// ── Draft type support ────────────────────────────────────────────────────────

type C2CDraftType =
  | 'c2c_snake'
  | 'c2c_linear'
  | 'c2c_auction'
  | 'mock_draft'
  | 'offline'
  | 'auto'

export const C2C_DRAFT_TYPE_IDS: readonly C2CDraftType[] = [
  'c2c_snake',
  'c2c_linear',
  'c2c_auction',
  'mock_draft',
  'offline',
  'auto',
] as const

type C2CEngineCore = 'snake' | 'linear' | 'auction'

export function normalizeC2CDraftType(value: unknown): C2CDraftType {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'c2c_snake' || raw === 'snake') return 'c2c_snake'
  if (raw === 'c2c_linear' || raw === 'linear') return 'c2c_linear'
  if (raw === 'c2c_auction' || raw === 'auction') return 'c2c_auction'
  if (raw === 'mock_draft' || raw === 'mock') return 'mock_draft'
  if (raw === 'offline') return 'offline'
  if (raw === 'auto') return 'auto'
  return 'c2c_snake'
}

function getC2CEngineCore(draftType: C2CDraftType): C2CEngineCore {
  if (draftType === 'c2c_auction') return 'auction'
  if (draftType === 'c2c_linear') return 'linear'
  return 'snake'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function asPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function starterCount(slots: Record<string, number>): number {
  return Object.values(slots).reduce((t, n) => t + n, 0)
}

function pickOrderForEngine(core: C2CEngineCore): 'snake' | 'linear' | 'auction' {
  return core
}

// ── Scoring helpers ───────────────────────────────────────────────────────────

function defaultProScoringPresetId(sport: C2CSport): string {
  return sport === 'NCAAF' ? 'ncaaf_half_ppr' : 'fb_half_ppr'
}

function defaultCollegeScoringPresetId(): string {
  return 'ncaaf_half_ppr'
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

function scoringTemplateId(sport: C2CSport, presetId: string): string {
  const fmt = scoringFormatForPreset(presetId)
  if (sport === 'NCAAF') {
    if (fmt === 'standard') return 'default-NCAAF-standard'
    if (fmt === 'ppr') return 'default-NCAAF-PPR'
    return 'default-NCAAF-HALF_PPR'
  }
  if (fmt === 'standard') return 'default-NFL-standard'
  if (fmt === 'ppr') return 'default-NFL-PPR'
  return 'default-NFL-HALF_PPR'
}

function scoringAliasesForPreset(sport: C2CSport, presetId: string): string[] {
  const fmt = scoringFormatForPreset(presetId)
  if (sport === 'NCAAF') {
    if (fmt === 'standard') return ['standard_college', 'ncaaf_standard_college']
    if (fmt === 'ppr') return ['ppr_college', 'ncaaf_ppr_college']
    return ['half_ppr_college', 'ncaaf_half_ppr_college']
  }
  if (fmt === 'standard') return ['standard', 'fb_standard']
  if (fmt === 'ppr') return ['ppr', 'fb_full_ppr', 'fb_ppr']
  return ['half_ppr', 'fb_half_ppr']
}

// ── Sub-types ─────────────────────────────────────────────────────────────────

interface C2CProRosterTemplate {
  rosterMode: 'c2c'
  starterSlots: Record<string, number>
  flexDefinitions: Array<{ slotName: string; allowedPositions: string[] }>
  benchSlots: number
  irSlots: number
  taxiSlots: number
  rosterSlots: number
  activeRosterSlots: number
  startupDraftRounds: number
  totalRosterSlots: number
  draftablePlayerPositions: string[]
  defensePosition: 'DST' | null
}

interface C2CCollegeRosterTemplate {
  rosterMode: 'c2c_campus'
  starterSlots: Record<string, number>
  flexDefinitions: Array<{ slotName: string; allowedPositions: string[] }>
  collegeRosterSize: number
  draftableCollegePositions: string[]
  collegeDraftRounds: number
}

interface C2CDraftPhaseSettings {
  enabled: boolean
  lifecycle: 'startup_pro' | 'startup_college' | 'rookie' | 'college' | 'supplemental'
  draftType: C2CEngineCore
  rounds: number
  poolType: string
  playerPool: string
  pickOrder: 'snake' | 'linear' | 'auction' | 'reverse_standings' | 'commissioner'
  futurePicksTied?: boolean
  commissionerTriggered?: boolean
  phaseAwarePoolOnly?: boolean
}

interface C2CDraftSettings {
  draftType: C2CEngineCore
  requestedDraftType: C2CDraftType
  engineCore: C2CEngineCore
  rounds: number
  timerSeconds: number
  slowTimerSeconds: number
  pickOrderRules: 'snake' | 'linear' | 'auction'
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
  mockDraftEnabled: boolean
  doesNotMutateRealRosters: boolean
  offlineModeEnabled: boolean
  commissionerPickEntryEnabled: boolean
  autoDraftEnabled: boolean
  eligiblePoolIsPhaseAware: true
  startupProDraft: C2CDraftPhaseSettings
  startupCollegeDraft: C2CDraftPhaseSettings
  rookieDraft: C2CDraftPhaseSettings
  collegeDraft: C2CDraftPhaseSettings
  supplementalDraft: C2CDraftPhaseSettings
}

interface C2CSettings {
  enabled: true
  adapterId: 'nfl_c2c'
  dynastyOnly: true
  startupFormat: 'separate'
  standingsModel: 'hybrid'
  collegeSports: ['NCAAF']
  collegeRosterSize: number
  rookieDraftRounds: number
  collegeDraftRounds: number
  taxiSize: number
  bestBallPro: false
  bestBallCollege: false
  startupDraftType: C2CEngineCore
  rookieDraftType: 'linear'
  collegeDraftType: C2CEngineCore
  rookiePickOrderMethod: 'reverse_standings'
  collegePickOrderMethod: 'reverse_standings'
  rookiePickTradeRules: 'allowed'
  collegePickTradeRules: 'allowed'
  c2cCollegeExcludeKDST: true
  promotionTiming: 'manager_choice_before_rookie_draft'
  returnToSchoolHandling: 'restore_rights'
  earlyDeclareBehavior: 'allowed_with_commissioner_approval'
  maxPromotionsPerYear: null
  mixProPlayers: false
  collegeFAEnabled: boolean
  collegeFAABSeparate: boolean
  collegeFAABBudget: number | null
  hybridProWeight: 0.6
  hybridCollegeWeight: 0.4
  hybridPlayoffQualification: 'combined'
  hybridChampionshipTieBreaker: 'pro_first'
  // Automation statuses
  promotionEngineStatus: 'pending'
  graduationProcessingStatus: 'pending'
  identityLinkingStatus: 'pending'
  hybridStandingsStatus: 'pending'
  mergedStartupDraftStatus: 'pending'
  offseasonPhase: 'setup'
}

interface C2CDefaultContract {
  sport: C2CSport
  league_type: 'c2c'
  leagueType: 'c2c'
  draft_type: C2CEngineCore
  requested_draft_type: C2CDraftType
  teams: number
  timer_seconds: number
  scoring_preset_id: string
  college_scoring_preset_id: string
  scoringPresetAliases: string[]
  roster_mode: 'c2c'
  proRosterTemplate: C2CProRosterTemplate
  collegeRosterTemplate: C2CCollegeRosterTemplate
  scoringSettings: Record<string, unknown>
  collegeScoringSettings: Record<string, unknown>
  waiverSettings: Record<string, unknown>
  tradeSettings: Record<string, unknown>
  draftSettings: C2CDraftSettings
  c2cSettings: C2CSettings
  proPlayerPoolRules: Record<string, unknown>
  collegePlayerPoolRules: Record<string, unknown>
  rookiePlayerPoolRules: Record<string, unknown>
  tabsEnabled: Record<string, true | 'commissioner' | 'pending'>
  mockDraftRules: Record<string, unknown>
  liveDraftRules: Record<string, unknown>
  disabledSettings: Record<string, boolean | string>
}

// ── Builders ──────────────────────────────────────────────────────────────────

function buildProRosterTemplate(sport: C2CSport): C2CProRosterTemplate {
  const starterSlots = { ...NFL_C2C_PRO_LINEUP_DEFAULT }
  const benchSlots = NFL_C2C_PRO_BENCH
  const irSlots = NFL_C2C_PRO_IR
  const taxiSlots = NFL_C2C_TAXI
  const rosterSlots = starterCount(starterSlots)
  const startupDraftRounds = rosterSlots + benchSlots + taxiSlots
  return {
    rosterMode: 'c2c',
    starterSlots,
    flexDefinitions: [
      { slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'] },
      { slotName: 'SUPER_FLEX', allowedPositions: ['QB', 'RB', 'WR', 'TE'] },
    ],
    benchSlots,
    irSlots,
    taxiSlots,
    rosterSlots,
    activeRosterSlots: rosterSlots + benchSlots,
    startupDraftRounds,
    totalRosterSlots: rosterSlots + benchSlots + irSlots + taxiSlots,
    draftablePlayerPositions: ['QB', 'RB', 'WR', 'TE', 'K', 'DST'],
    defensePosition: 'DST',
  }
}

function buildCollegeRosterTemplate(): C2CCollegeRosterTemplate {
  const starterSlots = { ...NFL_C2C_COLLEGE_LINEUP_DEFAULT }
  return {
    rosterMode: 'c2c_campus',
    starterSlots,
    flexDefinitions: [{ slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'] }],
    collegeRosterSize: NFL_C2C_COLLEGE_ROSTER_SIZE,
    draftableCollegePositions: [...NFL_C2C_COLLEGE_POSITIONS],
    collegeDraftRounds: NFL_C2C_COLLEGE_DRAFT_ROUNDS,
  }
}

function buildScoringSettings(
  sport: C2CSport,
  proPresetId: string,
): Record<string, unknown> {
  const fmt = scoringFormatForPreset(proPresetId)
  const ppr = scoringPprValue(proPresetId)
  return {
    source: 'af',
    sport,
    preset: proPresetId,
    scoringPresetId: proPresetId,
    scoringTemplateId: scoringTemplateId(sport, proPresetId),
    scoringMode: 'points',
    scoringFormat: fmt,
    format: fmt,
    ppr,
    superflex: true,
    tePremium: false,
    tePremiumMultiplier: 1,
    idp: false,
    keeper: false,
    dynasty: true,
    c2c: true,
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

function buildCollegeScoringSettings(): Record<string, unknown> {
  const presetId = defaultCollegeScoringPresetId()
  const fmt = scoringFormatForPreset(presetId)
  const ppr = scoringPprValue(presetId)
  return {
    source: 'af',
    sport: 'NCAAF',
    preset: presetId,
    scoringPresetId: presetId,
    scoringTemplateId: 'default-NCAAF-HALF_PPR',
    scoringMode: 'points',
    scoringFormat: `${fmt}_college`,
    format: fmt,
    ppr,
    superflex: false,
    tePremium: false,
    c2c: true,
    collegeOnly: true,
    rules: {
      ppr,
      passingTouchdown: 4,
      receivingTouchdown: 6,
      rushingTouchdown: 6,
    },
  }
}

function buildC2CSettings(
  draftType: C2CDraftType,
  collegeRosterTemplate: C2CCollegeRosterTemplate,
): C2CSettings {
  const engineCore = getC2CEngineCore(draftType)
  return {
    enabled: true,
    adapterId: 'nfl_c2c',
    dynastyOnly: true,
    startupFormat: 'separate',
    standingsModel: 'hybrid',
    collegeSports: ['NCAAF'],
    collegeRosterSize: collegeRosterTemplate.collegeRosterSize,
    rookieDraftRounds: NFL_C2C_ROOKIE_DRAFT_ROUNDS,
    collegeDraftRounds: NFL_C2C_COLLEGE_DRAFT_ROUNDS,
    taxiSize: NFL_C2C_TAXI,
    bestBallPro: false,
    bestBallCollege: false,
    startupDraftType: engineCore,
    rookieDraftType: 'linear',
    collegeDraftType: engineCore,
    rookiePickOrderMethod: 'reverse_standings',
    collegePickOrderMethod: 'reverse_standings',
    rookiePickTradeRules: 'allowed',
    collegePickTradeRules: 'allowed',
    c2cCollegeExcludeKDST: true,
    promotionTiming: 'manager_choice_before_rookie_draft',
    returnToSchoolHandling: 'restore_rights',
    earlyDeclareBehavior: 'allowed_with_commissioner_approval',
    maxPromotionsPerYear: null,
    mixProPlayers: false,
    collegeFAEnabled: true,
    collegeFAABSeparate: true,
    collegeFAABBudget: 100,
    hybridProWeight: 0.6,
    hybridCollegeWeight: 0.4,
    hybridPlayoffQualification: 'combined',
    hybridChampionshipTieBreaker: 'pro_first',
    // Phase 2 automation — all pending
    promotionEngineStatus: 'pending',
    graduationProcessingStatus: 'pending',
    identityLinkingStatus: 'pending',
    hybridStandingsStatus: 'pending',
    mergedStartupDraftStatus: 'pending',
    offseasonPhase: 'setup',
  }
}

function buildProPlayerPoolRules(
  sport: C2CSport,
  proTemplate: C2CProRosterTemplate,
): Record<string, unknown> {
  return {
    sport: 'NFL',
    poolKey: 'nfl_active_fantasy_players',
    source: 'sports_player',
    includeActiveOnly: true,
    includeNflPlayers: true,
    includeCollegePlayers: false,
    collegeOnly: false,
    excludeCollegePool: true,
    phaseAware: true,
    poolPhase: 'startup_pro',
    rankingSource: 'c2c_rank_or_dynasty_adp',
    positions: proTemplate.draftablePlayerPositions,
    positionAliases: { DST: ['DEF'] },
  }
}

function buildCollegePlayerPoolRules(
  sport: C2CSport,
  collegeTemplate: C2CCollegeRosterTemplate,
): Record<string, unknown> {
  return {
    sport: 'NCAAF',
    poolKey: 'ncaaf_active_college_c2c_players',
    source: 'sports_player',
    includeActiveOnly: true,
    includeCollegePlayers: true,
    includeNflPlayers: false,
    collegeOnly: true,
    excludeNflPool: true,
    excludeGraduatedPlayers: true,
    phaseAware: true,
    poolPhase: 'startup_college',
    rankingSource: 'c2c_college_rank_or_adp_fallback',
    positions: collegeTemplate.draftableCollegePositions,
    positionAliases: { DEF: ['DST'] },
    c2cCollegeExcludeKDST: true,
  }
}

function buildRookiePlayerPoolRules(): Record<string, unknown> {
  return {
    sport: 'NFL',
    poolKey: 'nfl_rookie_only',
    source: 'sports_player',
    includeActiveOnly: false,
    rookieOnly: true,
    includeNflPlayers: true,
    includeCollegePlayers: false,
    phaseAware: true,
    poolPhase: 'rookie',
    rankingSource: 'rookie_rank_or_adp',
    positions: ['QB', 'RB', 'WR', 'TE'],
  }
}

function buildDraftSettings(
  sport: C2CSport,
  draftType: C2CDraftType,
  proTemplate: C2CProRosterTemplate,
  proPool: Record<string, unknown>,
  collegePool: Record<string, unknown>,
  rookiePool: Record<string, unknown>,
): C2CDraftSettings {
  const engineCore = getC2CEngineCore(draftType)
  const isAuction = engineCore === 'auction'
  const isLinear = engineCore === 'linear'
  const isMock = draftType === 'mock_draft'
  const isOffline = draftType === 'offline'
  const isAuto = draftType === 'auto'
  const pickOrderRules = engineCore
  const snakeOrLinear: 'snake' | 'linear' = isLinear ? 'linear' : 'snake'

  const startupProDraft: C2CDraftPhaseSettings = {
    enabled: true,
    lifecycle: 'startup_pro',
    draftType: engineCore,
    rounds: proTemplate.startupDraftRounds,
    poolType: 'startup_pro',
    playerPool: String(proPool.poolKey),
    pickOrder: isAuction ? 'auction' : snakeOrLinear,
    phaseAwarePoolOnly: true,
  }

  const startupCollegeDraft: C2CDraftPhaseSettings = {
    enabled: true,
    lifecycle: 'startup_college',
    draftType: engineCore,
    rounds: NFL_C2C_COLLEGE_DRAFT_ROUNDS,
    poolType: 'startup_college',
    playerPool: String(collegePool.poolKey),
    pickOrder: isAuction ? 'auction' : snakeOrLinear,
    phaseAwarePoolOnly: true,
  }

  const rookieDraft: C2CDraftPhaseSettings = {
    enabled: true,
    lifecycle: 'rookie',
    draftType: 'linear',
    rounds: NFL_C2C_ROOKIE_DRAFT_ROUNDS,
    poolType: 'rookie',
    playerPool: String(rookiePool.poolKey),
    pickOrder: 'reverse_standings',
    futurePicksTied: true,
    phaseAwarePoolOnly: true,
  }

  const collegeDraft: C2CDraftPhaseSettings = {
    enabled: true,
    lifecycle: 'college',
    draftType: engineCore,
    rounds: NFL_C2C_COLLEGE_DRAFT_ROUNDS,
    poolType: 'college',
    playerPool: String(collegePool.poolKey),
    pickOrder: 'reverse_standings',
    futurePicksTied: true,
    phaseAwarePoolOnly: true,
  }

  const supplementalDraft: C2CDraftPhaseSettings = {
    enabled: true,
    lifecycle: 'supplemental',
    draftType: snakeOrLinear,
    rounds: 1,
    poolType: 'supplemental',
    playerPool: String(proPool.poolKey),
    pickOrder: 'commissioner',
    commissionerTriggered: true,
  }

  return {
    draftType: engineCore,
    requestedDraftType: draftType,
    engineCore,
    rounds: proTemplate.startupDraftRounds,
    timerSeconds: 90,
    slowTimerSeconds: 28_800,
    pickOrderRules,
    snakeOrLinear,
    sameOrderEveryRound: isLinear,
    thirdRoundReversal: false,
    autopickBehavior: 'queue-first',
    autopickBehaviorAlias: 'queue_first',
    queueSizeLimit: 80,
    preDraftRankingSource: 'c2c_rank_or_dynasty_adp',
    rosterFillOrder: 'position_scarcity',
    positionFilterBehavior: 'by_eligibility',
    auctionBudgetPerTeam: isAuction ? 200 : null,
    nominationOrderEnabled: isAuction,
    timerDisabled: isOffline,
    mockDraftEnabled: isMock,
    doesNotMutateRealRosters: isMock,
    offlineModeEnabled: isOffline,
    commissionerPickEntryEnabled: isOffline,
    autoDraftEnabled: isAuto,
    eligiblePoolIsPhaseAware: true,
    startupProDraft,
    startupCollegeDraft,
    rookieDraft,
    collegeDraft,
    supplementalDraft,
  }
}

function buildWaiverSettings(): Record<string, unknown> {
  return {
    waiverType: 'faab',
    faabBudget: 100,
    processingDays: [2],
    processingTimeUtc: '10:00',
    freeAgentUnlockBehavior: 'after_waiver_run',
    gameLockBehavior: 'game_time',
    collegeFreeAgencyEnabled: true,
    collegeFAABSeparate: true,
    collegeFAABBudget: 100,
  }
}

function buildTradeSettings(): Record<string, unknown> {
  return {
    tradeCenterEnabled: true,
    tradeReviewMode: 'commissioner',
    futureRookiePicksEnabled: true,
    futureCollegePicksEnabled: true,
    futurePicksEnabled: true,
    collegeAssetsTradeable: true,
    rookiePickTradeRules: 'allowed',
    collegePickTradeRules: 'allowed',
  }
}

function buildTabsEnabled(
  draftType: C2CDraftType,
): Record<string, true | 'commissioner' | 'pending'> {
  const isMock = draftType === 'mock_draft'
  return {
    overview: true,
    teams: true,
    canton_roster: true,
    campus_roster: true,
    rosters: true,
    roster: true,
    taxi: true,
    future_picks: true,
    standings: true,
    matchups: true,
    schedule: true,
    startup_pro_draft: true,
    startup_college_draft: true,
    college_draft: true,
    rookie_draft: true,
    mock_draft: isMock ? true : 'pending',
    live_draft: true,
    waivers: true,
    free_agents: true,
    trade_center: true,
    trades: true,
    scoring: true,
    settings: 'commissioner',
    commissioner_tools: 'commissioner',
    promotion_center: 'pending',
    hybrid_standings: 'pending',
  }
}

function buildDisabledSettings(): Record<string, boolean | string> {
  return {
    devy: false,
    devy_enabled: false,
    keeper: false,
    keeper_enabled: false,
    best_ball: false,
    best_ball_enabled: false,
    guillotine: false,
    guillotine_enabled: false,
    survivor: false,
    survivor_enabled: false,
    tournament: false,
    tournament_enabled: false,
    salary_cap: false,
    salary_cap_enabled: false,
    contracts: false,
    contracts_enabled: false,
    isDynastyOnly: true,
    taxi_is_pro_only: true,
  }
}

function buildMockDraftRules(
  draftSettings: C2CDraftSettings,
): Record<string, unknown> {
  return {
    enabled: draftSettings.mockDraftEnabled,
    surface: 'mock',
    draftType: draftSettings.draftType,
    requestedDraftType: draftSettings.requestedDraftType,
    rounds: draftSettings.rounds,
    timerSeconds: draftSettings.timerSeconds,
    queueSizeLimit: draftSettings.queueSizeLimit,
    doesNotMutateRealRosters: true,
    doesNotMutateCollegeAssets: true,
    doesNotMutateRookiePicks: true,
    doesNotMutateCollegePicks: true,
    eligiblePoolIsPhaseAware: true,
    usesSameDraftSettings: true,
  }
}

function buildLiveDraftRules(
  draftSettings: C2CDraftSettings,
): Record<string, unknown> {
  return {
    enabled: true,
    surface: 'live',
    draftType: draftSettings.draftType,
    requestedDraftType: draftSettings.requestedDraftType,
    rounds: draftSettings.rounds,
    timerSeconds: draftSettings.timerSeconds,
    queueSizeLimit: draftSettings.queueSizeLimit,
    eligiblePoolIsPhaseAware: true,
    phaseAwarePoolEnforced: true,
    proPoolExcludesCollegePlayers: true,
    collegePoolExcludesNFLPlayers: true,
    offlineModeEnabled: draftSettings.offlineModeEnabled,
    commissionerPickEntryEnabled: draftSettings.commissionerPickEntryEnabled,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getC2CDefaultContract(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): C2CDefaultContract | null {
  const normalizedSport = String(input.sport ?? '').trim().toUpperCase()
  if (!isC2CEligibleSport(normalizedSport)) return null

  const sport = normalizedSport
  const draftType = normalizeC2CDraftType(input.draftType)
  const proScoringPresetId =
    typeof input.scoringPresetId === 'string' && input.scoringPresetId.trim()
      ? input.scoringPresetId.trim()
      : defaultProScoringPresetId(sport)
  const collegeScoringPresetId = defaultCollegeScoringPresetId()

  const proRosterTemplate = buildProRosterTemplate(sport)
  const collegeRosterTemplate = buildCollegeRosterTemplate()
  const proPlayerPoolRules = buildProPlayerPoolRules(sport, proRosterTemplate)
  const collegePlayerPoolRules = buildCollegePlayerPoolRules(sport, collegeRosterTemplate)
  const rookiePlayerPoolRules = buildRookiePlayerPoolRules()
  const draftSettings = buildDraftSettings(
    sport,
    draftType,
    proRosterTemplate,
    proPlayerPoolRules,
    collegePlayerPoolRules,
    rookiePlayerPoolRules,
  )
  const scoringSettings = buildScoringSettings(sport, proScoringPresetId)
  const collegeScoringSettings = buildCollegeScoringSettings()
  const c2cSettings = buildC2CSettings(draftType, collegeRosterTemplate)
  const tabsEnabled = buildTabsEnabled(draftType)
  const disabledSettings = buildDisabledSettings()

  return {
    sport,
    league_type: 'c2c',
    leagueType: 'c2c',
    draft_type: draftSettings.draftType,
    requested_draft_type: draftType,
    teams: asPositiveInt(input.teamCount, 12),
    timer_seconds: draftSettings.timerSeconds,
    scoring_preset_id: proScoringPresetId,
    college_scoring_preset_id: collegeScoringPresetId,
    scoringPresetAliases: scoringAliasesForPreset(sport, proScoringPresetId),
    roster_mode: 'c2c',
    proRosterTemplate,
    collegeRosterTemplate,
    scoringSettings,
    collegeScoringSettings,
    waiverSettings: buildWaiverSettings(),
    tradeSettings: buildTradeSettings(),
    draftSettings,
    c2cSettings,
    proPlayerPoolRules,
    collegePlayerPoolRules,
    rookiePlayerPoolRules,
    tabsEnabled,
    mockDraftRules: buildMockDraftRules(draftSettings),
    liveDraftRules: buildLiveDraftRules(draftSettings),
    disabledSettings,
  }
}

export function buildC2CSettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): Record<string, unknown> | null {
  const contract = getC2CDefaultContract(input)
  if (!contract) return null

  const { draftSettings, c2cSettings, proRosterTemplate, collegeRosterTemplate } = contract
  return {
    c2cDefaultsVersion: 1,
    sport: contract.sport,
    sport_type: contract.sport,
    leagueType: 'c2c',
    league_type: 'c2c',
    roster_mode: 'c2c',
    isDynasty: true,
    isC2C: true,
    c2c: true,
    teams: contract.teams,
    default_team_count: contract.teams,
    // Pro/canton side
    scoring_preset_id: contract.scoring_preset_id,
    scoringPreset: contract.scoring_preset_id,
    scoringPresetAliases: contract.scoringPresetAliases,
    scoring_mode: 'points',
    scoring_format: contract.scoringSettings.scoringFormat,
    scoring_template_id: contract.scoringSettings.scoringTemplateId,
    // Campus/college side
    college_scoring_preset_id: contract.college_scoring_preset_id,
    collegeScoringPresetId: contract.college_scoring_preset_id,
    // Draft
    draft_type: draftSettings.draftType,
    requested_draft_type: draftSettings.requestedDraftType,
    draft_engine_core: draftSettings.engineCore,
    draft_timer_seconds: draftSettings.timerSeconds,
    draft_slow_timer_seconds: draftSettings.slowTimerSeconds,
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
    draft_rounds: draftSettings.rounds,
    rounds: draftSettings.rounds,
    timer_seconds: draftSettings.timerSeconds,
    auction_budget_per_team: draftSettings.auctionBudgetPerTeam,
    auctionBudgetPerTeam: draftSettings.auctionBudgetPerTeam,
    nomination_order_enabled: draftSettings.nominationOrderEnabled,
    // Draft phase settings
    startup_pro_draft_rounds: draftSettings.startupProDraft.rounds,
    startup_college_draft_rounds: draftSettings.startupCollegeDraft.rounds,
    startupProDraftSettings: draftSettings.startupProDraft,
    startupCollegeDraftSettings: draftSettings.startupCollegeDraft,
    rookieDraftSettings: draftSettings.rookieDraft,
    collegeDraftSettings: draftSettings.collegeDraft,
    supplementalDraftSettings: draftSettings.supplementalDraft,
    // Pro roster
    roster_size: proRosterTemplate.activeRosterSlots,
    rosterSize: proRosterTemplate.activeRosterSlots,
    starter_slots: proRosterTemplate.starterSlots,
    bench_slots: proRosterTemplate.benchSlots,
    ir_slots: proRosterTemplate.irSlots,
    taxi_slots: proRosterTemplate.taxiSlots,
    taxiSlots: proRosterTemplate.taxiSlots,
    startup_draft_rounds: proRosterTemplate.startupDraftRounds,
    proRosterTemplate,
    proRosterSettings: {
      rosterMode: 'c2c',
      starterSlots: proRosterTemplate.starterSlots,
      flexDefinitions: proRosterTemplate.flexDefinitions,
      benchSlots: proRosterTemplate.benchSlots,
      irSlots: proRosterTemplate.irSlots,
      taxiSlots: proRosterTemplate.taxiSlots,
      rosterSlots: proRosterTemplate.rosterSlots,
      activeRosterSlots: proRosterTemplate.activeRosterSlots,
      startupDraftRounds: proRosterTemplate.startupDraftRounds,
      draftablePlayerPositions: proRosterTemplate.draftablePlayerPositions,
    },
    // Campus roster
    college_roster_size: collegeRosterTemplate.collegeRosterSize,
    collegeRosterSize: collegeRosterTemplate.collegeRosterSize,
    college_draft_rounds_startup: collegeRosterTemplate.collegeDraftRounds,
    collegeRosterSlots: collegeRosterTemplate.collegeRosterSize,
    collegeRosterTemplate,
    collegeRosterSettings: {
      rosterMode: 'c2c_campus',
      starterSlots: collegeRosterTemplate.starterSlots,
      flexDefinitions: collegeRosterTemplate.flexDefinitions,
      collegeRosterSize: collegeRosterTemplate.collegeRosterSize,
      draftableCollegePositions: collegeRosterTemplate.draftableCollegePositions,
      collegeDraftRounds: collegeRosterTemplate.collegeDraftRounds,
    },
    scoringSettings: contract.scoringSettings,
    collegeScoringSettings: contract.collegeScoringSettings,
    waiverSettings: contract.waiverSettings,
    tradeSettings: contract.tradeSettings,
    draftSettings,
    c2cSettings,
    c2cConfig: c2cSettings,
    proPlayerPoolRules: contract.proPlayerPoolRules,
    collegePlayerPoolRules: contract.collegePlayerPoolRules,
    rookiePlayerPoolRules: contract.rookiePlayerPoolRules,
    player_pool: contract.proPlayerPoolRules.poolKey,
    college_player_pool: contract.collegePlayerPoolRules.poolKey,
    rookie_player_pool: contract.rookiePlayerPoolRules.poolKey,
    tabsEnabled: contract.tabsEnabled,
    tabs_enabled: contract.tabsEnabled,
    mockDraftRules: contract.mockDraftRules,
    live_draft_rules: contract.liveDraftRules,
    liveDraftRules: contract.liveDraftRules,
    // C2C flags
    c2c_enabled: true,
    c2c_adapter_id: c2cSettings.adapterId,
    dynasty_carryover_enabled: true,
    taxi: true,
    taxi_enabled: true,
    future_rookie_picks: true,
    future_rookie_picks_enabled: true,
    future_college_picks: true,
    future_college_picks_enabled: true,
    future_picks: true,
    future_picks_enabled: true,
    // C2C config flags
    startup_format: c2cSettings.startupFormat,
    startupFormat: c2cSettings.startupFormat,
    standings_model: c2cSettings.standingsModel,
    standingsModel: c2cSettings.standingsModel,
    college_sports: c2cSettings.collegeSports,
    college_roster_size_setting: c2cSettings.collegeRosterSize,
    rookie_draft_rounds: c2cSettings.rookieDraftRounds,
    college_draft_rounds: c2cSettings.collegeDraftRounds,
    taxi_size: c2cSettings.taxiSize,
    best_ball_pro: c2cSettings.bestBallPro,
    best_ball_college: c2cSettings.bestBallCollege,
    promotion_timing: c2cSettings.promotionTiming,
    return_to_school_handling: c2cSettings.returnToSchoolHandling,
    hybrid_pro_weight: c2cSettings.hybridProWeight,
    hybrid_college_weight: c2cSettings.hybridCollegeWeight,
    hybrid_standings_config: {
      proWeight: c2cSettings.hybridProWeight,
      collegeWeight: c2cSettings.hybridCollegeWeight,
      playoffQualification: c2cSettings.hybridPlayoffQualification,
      championshipTieBreaker: c2cSettings.hybridChampionshipTieBreaker,
    },
    // Promotion/lifecycle transitions
    promotionTransitionRules: {
      promotionTiming: c2cSettings.promotionTiming,
      returnToSchoolHandling: c2cSettings.returnToSchoolHandling,
      earlyDeclareBehavior: c2cSettings.earlyDeclareBehavior,
      maxPromotionsPerYear: c2cSettings.maxPromotionsPerYear,
      graduatedPlayersExcludedFromActiveCollegePool: true,
      duplicateIdentityResolution: 'c2c_player_mapping',
    },
    // Automation statuses — all pending Phase 2
    promotion_engine_status: c2cSettings.promotionEngineStatus,
    graduation_processing_status: c2cSettings.graduationProcessingStatus,
    identity_linking_status: c2cSettings.identityLinkingStatus,
    hybrid_standings_status: c2cSettings.hybridStandingsStatus,
    merged_startup_draft_status: c2cSettings.mergedStartupDraftStatus,
    offseason_phase: c2cSettings.offseasonPhase,
    // Guardrails
    ...contract.disabledSettings,
    devyConfig: { enabled: false },
    keeperSettings: { enabled: false },
    bestBallSettings: { enabled: false },
    survivorConfig: { enabled: false },
    guillotineConfig: { enabled: false },
    tournamentConfig: { enabled: false },
    salaryCapSettings: { enabled: false },
  }
}

export function normalizeC2CSettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
  settings?: Record<string, unknown> | null
}): Record<string, unknown> {
  const incoming = input.settings ?? {}
  const draftType = normalizeC2CDraftType(
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
    buildC2CSettingsSnapshot({
      sport: input.sport,
      draftType,
      scoringPresetId,
      teamCount,
    }) ?? {}

  const merged: Record<string, unknown> = { ...defaults, ...incoming }

  // Hard-enforce C2C identity
  merged.leagueType = 'c2c'
  merged.league_type = 'c2c'
  merged.roster_mode = 'c2c'
  merged.isC2C = true
  merged.c2c = true
  merged.c2c_enabled = true
  merged.isDynasty = true
  merged.draft_type = getC2CEngineCore(draftType)
  merged.requested_draft_type = draftType
  merged.draft_engine_core = getC2CEngineCore(draftType)

  // Clamp roster sizes
  const collegeRosterSize = clampInt(
    merged.college_roster_size ?? merged.collegeRosterSize,
    NFL_C2C_COLLEGE_ROSTER_SIZE,
    5,
    50,
  )
  merged.college_roster_size = collegeRosterSize
  merged.collegeRosterSize = collegeRosterSize

  const rookieDraftRounds = clampInt(
    merged.rookie_draft_rounds,
    NFL_C2C_ROOKIE_DRAFT_ROUNDS,
    1,
    10,
  )
  merged.rookie_draft_rounds = rookieDraftRounds

  const collegeDraftRounds = clampInt(
    merged.college_draft_rounds,
    NFL_C2C_COLLEGE_DRAFT_ROUNDS,
    1,
    20,
  )
  merged.college_draft_rounds = collegeDraftRounds

  // Automation statuses always pending (Phase 2)
  merged.promotion_engine_status = 'pending'
  merged.graduation_processing_status = 'pending'
  merged.identity_linking_status = 'pending'
  merged.hybrid_standings_status = 'pending'
  merged.merged_startup_draft_status = 'pending'

  // Guardrails — always disabled
  merged.devy = false
  merged.devy_enabled = false
  merged.keeper = false
  merged.keeper_enabled = false
  merged.best_ball = false
  merged.guillotine = false
  merged.survivor = false
  merged.tournament = false
  merged.salary_cap = false
  merged.salary_cap_enabled = false

  return merged
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateC2CStructure(settings: Record<string, unknown>): string[] {
  const errors: string[] = []
  const sport = String(settings.sport ?? settings.sport_type ?? '')
  const draftType = String(settings.requested_draft_type ?? settings.draft_type ?? '')
  const collegeRosterSize = Number(settings.college_roster_size ?? settings.collegeRosterSize ?? 0)
  const rookieRounds = Number(settings.rookie_draft_rounds ?? 0)
  const collegeRounds = Number(settings.college_draft_rounds ?? 0)

  if (!isC2CEligibleSport(sport)) {
    errors.push(`C2C is not supported for sport: ${sport || '(unset)'}`)
  }
  if (!['c2c_snake', 'c2c_linear', 'c2c_auction', 'mock_draft', 'offline', 'auto'].includes(draftType)) {
    errors.push(`Invalid C2C draft type: ${draftType}. Must be c2c_snake, c2c_linear, or c2c_auction.`)
  }
  if (['snake', 'linear', 'auction', 'devy_snake', 'devy_linear', 'devy_auction'].includes(draftType)) {
    errors.push('C2C leagues must use c2c_* draft types, not plain snake/linear/auction or devy_* types.')
  }
  if (collegeRosterSize < 5) {
    errors.push('college_roster_size must be at least 5')
  }
  if (rookieRounds < 1) {
    errors.push('rookie_draft_rounds must be at least 1')
  }
  if (collegeRounds < 1) {
    errors.push('college_draft_rounds must be at least 1')
  }
  if (sport === 'NFL' && settings.college_player_pool === 'nfl_active_fantasy_players') {
    errors.push('NFL C2C college player pool must not be the NFL pro pool')
  }
  if (sport === 'NFL' && settings.player_pool === 'ncaaf_active_college_c2c_players') {
    errors.push('NFL C2C pro player pool must not be the NCAAF college pool')
  }
  if (settings.devy_enabled === true || settings.devy === true) {
    errors.push('C2C must not enable devy mode — C2C uses its own college tracking system')
  }
  return errors
}
