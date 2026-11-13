import type { LeagueSport } from '@prisma/client'

export type FootballDevySport = 'NFL' | 'NCAAF'
export type DevyCreateDraftType =
  | 'devy_snake'
  | 'devy_linear'
  | 'devy_auction'
  | 'snake'
  | 'linear'
  | 'auction'
  | 'mock_draft'
  | 'offline'
  | 'auto'

type CanonicalDevyDraftType = 'devy_snake' | 'devy_linear' | 'devy_auction' | 'mock_draft' | 'offline' | 'auto'
type EngineDraftType = 'snake' | 'linear' | 'auction'
type DevyPoolPhase = 'startup_pro' | 'startup_college_active' | 'devy' | 'rookie' | 'supplemental'

export interface DevyRosterTemplate {
  rosterMode: 'dynasty'
  starterSlots: Record<string, number>
  flexDefinitions: Array<{ slotName: string; allowedPositions: string[] }>
  benchSlots: number
  irSlots: number
  taxiSlots: number
  devySlots: number
  devyIRSlots: number
  rosterSlots: number
  activeRosterSlots: number
  startupDraftRounds: number
  totalRosterSlots: number
  draftablePlayerPositions: string[]
  devyDraftablePositions: string[]
  defensePosition: 'DST' | 'DEF' | null
}

export interface DevyDraftPhaseSettings {
  enabled: boolean
  lifecycle: 'startup_draft' | 'rookie_draft' | 'devy_draft' | 'supplemental_draft'
  draftType: EngineDraftType
  rounds: number
  poolType: DevyPoolPhase
  playerPool: string
  pickOrder: 'snake' | 'linear' | 'auction' | 'reverse_standings' | 'commissioner'
  futurePicksTied?: boolean
  commissionerTriggered?: boolean
  doesNotWipeFullProPool?: boolean
}

export interface DevyDraftSettings {
  draftType: EngineDraftType
  requestedDraftType: CanonicalDevyDraftType
  engineCore: EngineDraftType
  rounds: number
  startupVetRounds: number
  timerSeconds: number
  slowTimerSeconds: number
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
  mockDraftEnabled: boolean
  doesNotMutateRealRosters: boolean
  offlineModeEnabled: boolean
  commissionerPickEntryEnabled: boolean
  autoDraftEnabled: boolean
  eligiblePoolExcludesHeldDevy: true
  startupDraft: DevyDraftPhaseSettings
  rookieDraft: DevyDraftPhaseSettings
  devyDraft: DevyDraftPhaseSettings
  supplementalDraft: DevyDraftPhaseSettings
}

export interface DevySettings {
  enabled: true
  dynastyOnly: true
  adapterId: 'nfl_devy'
  collegeSports: ['NCAAF']
  devySlotCount: number
  devyIRSlots: number
  taxiSize: number
  rookieDraftRounds: number
  devyDraftRounds: number
  startupVetRounds: number
  bestBallEnabled: false
  startupDraftType: EngineDraftType
  rookieDraftType: EngineDraftType
  devyDraftType: EngineDraftType
  rookiePickOrderMethod: 'reverse_standings'
  devyPickOrderMethod: 'reverse_standings'
  devyPickTradeRules: 'allowed'
  rookiePickTradeRules: 'allowed'
  promotionTiming: 'manager_choice_before_rookie_draft'
  returnToSchoolHandling: 'restore_rights'
  nflDevyExcludeKDST: boolean
}

export interface DevyDefaultContract {
  sport: FootballDevySport
  league_type: 'devy'
  leagueType: 'devy'
  draft_type: EngineDraftType
  requested_draft_type: CanonicalDevyDraftType
  teams: number
  rounds: number
  timer_seconds: number
  scoring_preset_id: string
  scoringPresetAliases: string[]
  roster_mode: 'dynasty'
  rosterTemplate: DevyRosterTemplate
  scoringSettings: Record<string, unknown>
  waiverSettings: Record<string, unknown>
  tradeSettings: Record<string, unknown>
  draftSettings: DevyDraftSettings
  devySettings: DevySettings
  playerPoolRules: Record<string, unknown>
  proPlayerPoolRules: Record<string, unknown>
  devyPlayerPoolRules: Record<string, unknown>
  rookiePlayerPoolRules: Record<string, unknown>
  tabsEnabled: Record<string, true | 'commissioner'>
  mockDraftRules: Record<string, unknown>
  liveDraftRules: Record<string, unknown>
  disabledSettings: Record<string, unknown>
}

export const DEVY_CREATE_DRAFT_TYPE_IDS: readonly DevyCreateDraftType[] = [
  'devy_snake',
  'devy_linear',
  'devy_auction',
  'snake',
  'linear',
  'auction',
  'mock_draft',
  'offline',
  'auto',
] as const

const NFL_STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, SUPER_FLEX: 1 } as const
const NCAAF_STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 } as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function starterCount(starters: Record<string, number>): number {
  return Object.values(starters).reduce((total, count) => total + count, 0)
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

export function isFootballDevyDefaultsSport(sport: unknown): sport is FootballDevySport {
  const normalized = String(sport ?? '').trim().toUpperCase()
  return normalized === 'NFL' || normalized === 'NCAAF'
}

export function isSupportedDevyCreateDraftType(value: unknown): value is DevyCreateDraftType {
  const raw = String(value ?? '').trim().toLowerCase()
  return (DEVY_CREATE_DRAFT_TYPE_IDS as readonly string[]).includes(raw)
}

export function normalizeDevyDraftType(value: unknown): CanonicalDevyDraftType {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'auction' || raw === 'devy_auction') return 'devy_auction'
  if (raw === 'linear' || raw === 'devy_linear') return 'devy_linear'
  if (raw === 'offline') return 'offline'
  if (raw === 'auto') return 'auto'
  if (raw === 'mock_draft' || raw === 'mock') return 'mock_draft'
  return 'devy_snake'
}

export function getDevyEngineDraftType(draftType: unknown): EngineDraftType {
  const normalized = normalizeDevyDraftType(draftType)
  if (normalized === 'devy_auction') return 'auction'
  if (normalized === 'devy_linear') return 'linear'
  return 'snake'
}

function pickOrderForDraftType(draftType: unknown): 'snake' | 'linear' {
  return getDevyEngineDraftType(draftType) === 'linear' ? 'linear' : 'snake'
}

function defaultScoringPresetId(sport: FootballDevySport): string {
  return sport === 'NCAAF' ? 'ncaaf_half_ppr' : 'fb_half_ppr'
}

function scoringPprValue(presetId: string): number {
  const id = presetId.toLowerCase()
  if (id.includes('standard') || id.endsWith('_std')) return 0
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

function scoringTemplateId(sport: FootballDevySport, presetId: string): string {
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

function scoringAliasesForPreset(sport: FootballDevySport, presetId: string): string[] {
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

function buildRosterTemplate(sport: FootballDevySport): DevyRosterTemplate {
  const starterSlots = sport === 'NCAAF' ? { ...NCAAF_STARTERS } : { ...NFL_STARTERS }
  const rosterSlots = starterCount(starterSlots)
  const benchSlots = 12
  const irSlots = sport === 'NCAAF' ? 2 : 3
  const taxiSlots = 6
  const devySlots = 6
  const devyIRSlots = 2
  const draftablePlayerPositions = sport === 'NCAAF'
    ? ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
    : ['QB', 'RB', 'WR', 'TE']

  return {
    rosterMode: 'dynasty',
    starterSlots,
    flexDefinitions:
      sport === 'NCAAF'
        ? [{ slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'] }]
        : [
            { slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'] },
            { slotName: 'SUPER_FLEX', allowedPositions: ['QB', 'RB', 'WR', 'TE'] },
          ],
    benchSlots,
    irSlots,
    taxiSlots,
    devySlots,
    devyIRSlots,
    rosterSlots,
    activeRosterSlots: rosterSlots + benchSlots,
    startupDraftRounds: rosterSlots + benchSlots,
    totalRosterSlots: rosterSlots + benchSlots + irSlots + taxiSlots + devySlots,
    draftablePlayerPositions,
    devyDraftablePositions: ['QB', 'RB', 'WR', 'TE'],
    defensePosition: sport === 'NCAAF' ? 'DEF' : null,
  }
}

function buildScoringSettings(
  sport: FootballDevySport,
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
    superflex: sport === 'NFL',
    tePremium: false,
    tePremiumMultiplier: 1,
    idp: false,
    dynasty: true,
    devy: true,
    c2c: false,
    bestBall: false,
    keeper: false,
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

function buildProPlayerPoolRules(
  sport: FootballDevySport,
  rosterTemplate: DevyRosterTemplate,
): Record<string, unknown> {
  if (sport === 'NCAAF') {
    return {
      sport: 'NCAAF',
      poolKey: 'ncaaf_active_college_fantasy_players',
      poolType: 'startup_college_active',
      source: 'sports_player',
      includeActiveOnly: true,
      includeCollegePlayers: true,
      includeNflPlayers: false,
      collegeOnly: true,
      excludeNflPool: true,
      excludeGraduatedToNFL: true,
      positions: rosterTemplate.draftablePlayerPositions,
      positionAliases: { DEF: ['DST'] },
      rankingSource: 'ncaaf_devy_rank_fallback',
    }
  }
  return {
    sport: 'NFL',
    poolKey: 'nfl_active_fantasy_players',
    poolType: 'startup_pro',
    source: 'sports_player',
    includeActiveOnly: true,
    includeCollegePlayers: false,
    includeNflPlayers: true,
    collegeOnly: false,
    excludeCollegePool: true,
    excludeRookieOnlyPool: true,
    excludeKickerDefense: true,
    positions: rosterTemplate.draftablePlayerPositions,
    rankingSource: 'dynasty_adp',
  }
}

function buildDevyPlayerPoolRules(
  sport: FootballDevySport,
  rosterTemplate: DevyRosterTemplate,
): Record<string, unknown> {
  return {
    sport: 'NCAAF',
    parentFantasySport: sport,
    poolKey: sport === 'NCAAF' ? 'ncaaf_future_college_prospects' : 'ncaaf_devy_prospects',
    poolType: 'devy',
    source: 'devy_player',
    includeActiveOnly: false,
    includeCollegePlayers: true,
    includeNflPlayers: false,
    collegeOnly: true,
    devyEligibleOnly: true,
    graduatedToNFL: false,
    excludeGraduatedToNFL: true,
    excludeRosteredProPlayers: true,
    excludeHeldDevyRights: true,
    positions: rosterTemplate.devyDraftablePositions,
    rankingSource: 'devy_rank',
  }
}

function buildRookiePlayerPoolRules(sport: FootballDevySport): Record<string, unknown> {
  if (sport === 'NCAAF') {
    return {
      sport: 'NCAAF',
      poolKey: 'ncaaf_incoming_or_newly_available_college_players',
      poolType: 'rookie',
      source: 'devy_player',
      includeCollegePlayers: true,
      includeNflPlayers: false,
      collegeOnly: true,
      devyEligibleOnly: true,
      excludeHeldDevyRights: true,
      rankingSource: 'ncaaf_devy_rank_fallback',
    }
  }
  return {
    sport: 'NFL',
    poolKey: 'nfl_rookies_only',
    poolType: 'rookie',
    source: 'sports_player',
    includeCollegePlayers: false,
    includeNflPlayers: true,
    rookieOnly: true,
    excludeHeldDevyRights: true,
    excludeDevyHeldPromotedPlayers: true,
    rankingSource: 'rookie_adp',
  }
}

function buildPlayerPoolRules(
  sport: FootballDevySport,
  proPool: Record<string, unknown>,
  devyPool: Record<string, unknown>,
  rookiePool: Record<string, unknown>,
): Record<string, unknown> {
  return {
    sport,
    poolKey: proPool.poolKey,
    defaultStartupPool: proPool.poolKey,
    devyPoolKey: devyPool.poolKey,
    rookiePoolKey: rookiePool.poolKey,
    mode: 'separate_startup_rookie_devy_pools',
    ncaafDevyMeaning:
      sport === 'NCAAF'
        ? 'college_dynasty_with_future_college_assets'
        : 'nfl_dynasty_with_college_devy_assets',
    includeNflPlayers: sport === 'NFL',
    includeCollegePlayers: true,
    collegeOnly: sport === 'NCAAF',
    usesNflProPool: sport === 'NFL',
    activeCollegePoolSeparated: sport === 'NCAAF',
    startupPool: proPool,
    devyPool,
    rookiePool,
    keptPlayersRemovedFromPool: true,
    eligiblePoolExcludesHeldDevy: true,
  }
}

function buildDraftSettings(
  sport: FootballDevySport,
  draftType: CanonicalDevyDraftType,
  rosterTemplate: DevyRosterTemplate,
  proPool: Record<string, unknown>,
  devyPool: Record<string, unknown>,
  rookiePool: Record<string, unknown>,
): DevyDraftSettings {
  const engineDraftType = getDevyEngineDraftType(draftType)
  const pickOrderRules = pickOrderForDraftType(draftType)
  const isAuction = engineDraftType === 'auction'
  const isMock = draftType === 'mock_draft'
  const isOffline = draftType === 'offline'
  const isAuto = draftType === 'auto'
  const devyDraftType = isAuction ? 'auction' : pickOrderRules
  const queueSizeLimit = 80

  return {
    draftType: engineDraftType,
    requestedDraftType: draftType,
    engineCore: engineDraftType,
    rounds: rosterTemplate.startupDraftRounds,
    startupVetRounds: rosterTemplate.startupDraftRounds,
    timerSeconds: 90,
    slowTimerSeconds: 28_800,
    pickOrderRules,
    snakeOrLinear: pickOrderRules,
    sameOrderEveryRound: pickOrderRules === 'linear',
    thirdRoundReversal: false,
    autopickBehavior: 'queue-first',
    autopickBehaviorAlias: 'queue_first',
    queueSizeLimit,
    preDraftRankingSource: sport === 'NCAAF' ? 'ncaaf_devy_rank_fallback' : 'devy_rank_or_dynasty_adp',
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
    eligiblePoolExcludesHeldDevy: true,
    startupDraft: {
      enabled: true,
      lifecycle: 'startup_draft',
      draftType: engineDraftType,
      rounds: rosterTemplate.startupDraftRounds,
      poolType: sport === 'NCAAF' ? 'startup_college_active' : 'startup_pro',
      playerPool: String(proPool.poolKey),
      pickOrder: isAuction ? 'auction' : pickOrderRules,
    },
    rookieDraft: {
      enabled: true,
      lifecycle: 'rookie_draft',
      draftType: isAuction ? 'auction' : 'linear',
      rounds: 4,
      poolType: 'rookie',
      playerPool: String(rookiePool.poolKey),
      pickOrder: 'reverse_standings',
      futurePicksTied: true,
    },
    devyDraft: {
      enabled: true,
      lifecycle: 'devy_draft',
      draftType: devyDraftType,
      rounds: 4,
      poolType: 'devy',
      playerPool: String(devyPool.poolKey),
      pickOrder: 'reverse_standings',
      futurePicksTied: true,
    },
    supplementalDraft: {
      enabled: true,
      lifecycle: 'supplemental_draft',
      draftType: pickOrderRules,
      rounds: 1,
      poolType: 'supplemental',
      playerPool: String(devyPool.poolKey),
      pickOrder: 'commissioner',
      commissionerTriggered: true,
      doesNotWipeFullProPool: true,
    },
  }
}

function buildDevySettings(
  draftSettings: DevyDraftSettings,
  rosterTemplate: DevyRosterTemplate,
): DevySettings {
  return {
    enabled: true,
    dynastyOnly: true,
    adapterId: 'nfl_devy',
    collegeSports: ['NCAAF'],
    devySlotCount: rosterTemplate.devySlots,
    devyIRSlots: rosterTemplate.devyIRSlots,
    taxiSize: rosterTemplate.taxiSlots,
    rookieDraftRounds: draftSettings.rookieDraft.rounds,
    devyDraftRounds: draftSettings.devyDraft.rounds,
    startupVetRounds: draftSettings.startupVetRounds,
    bestBallEnabled: false,
    startupDraftType: draftSettings.startupDraft.draftType,
    rookieDraftType: draftSettings.rookieDraft.draftType,
    devyDraftType: draftSettings.devyDraft.draftType,
    rookiePickOrderMethod: 'reverse_standings',
    devyPickOrderMethod: 'reverse_standings',
    devyPickTradeRules: 'allowed',
    rookiePickTradeRules: 'allowed',
    promotionTiming: 'manager_choice_before_rookie_draft',
    returnToSchoolHandling: 'restore_rights',
    nflDevyExcludeKDST: true,
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
    devyFreeAgencyEnabled: false,
  }
}

function buildTradeSettings(): Record<string, unknown> {
  return {
    tradeCenterEnabled: true,
    tradeReviewMode: 'commissioner',
    futureRookiePicksEnabled: true,
    futureDevyPicksEnabled: true,
    devyRightsTradeable: true,
    rookiePickTradeRules: 'allowed',
    devyPickTradeRules: 'allowed',
  }
}

function buildDisabledSettings(): Record<string, unknown> {
  return {
    c2c: false,
    c2c_enabled: false,
    keeper: false,
    keeper_enabled: false,
    keepers: false,
    keepers_enabled: false,
    best_ball: false,
    best_ball_enabled: false,
    guillotine: false,
    guillotine_enabled: false,
    contracts: false,
    contracts_enabled: false,
    salary_cap: false,
    salary_cap_enabled: false,
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
    startup_draft: true,
    devy_draft: true,
    rookie_draft: true,
    mock_draft: true,
    live_draft: true,
    devy_assets: true,
    taxi: true,
    future_picks: true,
    trade_center: true,
    trades: true,
    waivers: true,
    scoring: true,
    settings: 'commissioner',
    commissioner_tools: 'commissioner',
  }
}

function buildSurfaceRules(
  surface: 'mock' | 'live',
  draftSettings: DevyDraftSettings,
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
    eligiblePoolExcludesHeldDevy: true,
    devyCostsVisible: true,
    doesNotMutateRealRosters: surface === 'mock',
    doesNotMutateDevyRights: surface === 'mock',
  }
}

export function getDevyDefaultContract(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): DevyDefaultContract | null {
  const normalizedSport = String(input.sport ?? '').trim().toUpperCase()
  if (!isFootballDevyDefaultsSport(normalizedSport)) return null

  const sport = normalizedSport
  const requestedDraftType = normalizeDevyDraftType(input.draftType)
  const rosterTemplate = buildRosterTemplate(sport)
  const proPlayerPoolRules = buildProPlayerPoolRules(sport, rosterTemplate)
  const devyPlayerPoolRules = buildDevyPlayerPoolRules(sport, rosterTemplate)
  const rookiePlayerPoolRules = buildRookiePlayerPoolRules(sport)
  const playerPoolRules = buildPlayerPoolRules(
    sport,
    proPlayerPoolRules,
    devyPlayerPoolRules,
    rookiePlayerPoolRules,
  )
  const draftSettings = buildDraftSettings(
    sport,
    requestedDraftType,
    rosterTemplate,
    proPlayerPoolRules,
    devyPlayerPoolRules,
    rookiePlayerPoolRules,
  )
  const scoringPresetId =
    typeof input.scoringPresetId === 'string' && input.scoringPresetId.trim()
      ? input.scoringPresetId.trim()
      : defaultScoringPresetId(sport)
  const scoringSettings = buildScoringSettings(sport, scoringPresetId)
  const devySettings = buildDevySettings(draftSettings, rosterTemplate)
  const tabsEnabled = buildTabsEnabled()
  const disabledSettings = buildDisabledSettings()

  return {
    sport,
    league_type: 'devy',
    leagueType: 'devy',
    draft_type: draftSettings.draftType,
    requested_draft_type: requestedDraftType,
    teams: asPositiveInt(input.teamCount, 12),
    rounds: draftSettings.rounds,
    timer_seconds: draftSettings.timerSeconds,
    scoring_preset_id: scoringPresetId,
    scoringPresetAliases: scoringAliasesForPreset(sport, scoringPresetId),
    roster_mode: 'dynasty',
    rosterTemplate,
    scoringSettings,
    waiverSettings: buildWaiverSettings(),
    tradeSettings: buildTradeSettings(),
    draftSettings,
    devySettings,
    playerPoolRules,
    proPlayerPoolRules,
    devyPlayerPoolRules,
    rookiePlayerPoolRules,
    tabsEnabled,
    mockDraftRules: buildSurfaceRules('mock', draftSettings),
    liveDraftRules: buildSurfaceRules('live', draftSettings),
    disabledSettings,
  }
}

export function buildDevySettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): Record<string, unknown> | null {
  const contract = getDevyDefaultContract(input)
  if (!contract) return null

  const { draftSettings, devySettings, rosterTemplate } = contract
  const devyConfig = {
    ...devySettings,
    devySlotCount: devySettings.devySlotCount,
    devyIRSlots: devySettings.devyIRSlots,
    taxiSize: devySettings.taxiSize,
    collegeSports: devySettings.collegeSports,
  }

  return {
    devyDefaultsVersion: 1,
    sport: contract.sport,
    sport_type: contract.sport,
    leagueType: 'devy',
    league_type: 'devy',
    roster_mode: 'dynasty',
    isDynasty: true,
    isDevy: true,
    devy: true,
    devy_enabled: true,
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
    startup_vet_rounds: draftSettings.startupVetRounds,
    rookie_draft_rounds: draftSettings.rookieDraft.rounds,
    devy_draft_rounds: draftSettings.devyDraft.rounds,
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
    draft_order: draftSettings.pickOrderRules,
    third_round_reversal: false,
    rounds: draftSettings.rounds,
    timer_seconds: draftSettings.timerSeconds,
    roster_size: rosterTemplate.activeRosterSlots,
    rosterSize: rosterTemplate.activeRosterSlots,
    starter_slots: rosterTemplate.starterSlots,
    bench_slots: rosterTemplate.benchSlots,
    ir_slots: rosterTemplate.irSlots,
    taxi_slots: rosterTemplate.taxiSlots,
    taxiSlots: rosterTemplate.taxiSlots,
    devy_slots: rosterTemplate.devySlots,
    devySlots: rosterTemplate.devySlots,
    devy_ir_slots: rosterTemplate.devyIRSlots,
    collegeRosterSlots: rosterTemplate.devySlots,
    rosterTemplate,
    rosterSettings: {
      rosterMode: 'dynasty',
      starterSlots: rosterTemplate.starterSlots,
      flexDefinitions: rosterTemplate.flexDefinitions,
      benchSlots: rosterTemplate.benchSlots,
      irSlots: rosterTemplate.irSlots,
      taxiSlots: rosterTemplate.taxiSlots,
      devySlots: rosterTemplate.devySlots,
      devyIRSlots: rosterTemplate.devyIRSlots,
      rosterSlots: rosterTemplate.rosterSlots,
      rosterSize: rosterTemplate.activeRosterSlots,
      startupDraftRounds: rosterTemplate.startupDraftRounds,
      draftablePlayerPositions: rosterTemplate.draftablePlayerPositions,
      devyDraftablePositions: rosterTemplate.devyDraftablePositions,
    },
    scoringSettings: contract.scoringSettings,
    waiverSettings: contract.waiverSettings,
    tradeSettings: contract.tradeSettings,
    draftSettings,
    devySettings,
    devyConfig,
    playerPoolRules: contract.playerPoolRules,
    player_pool_rules: contract.playerPoolRules,
    proPlayerPoolRules: contract.proPlayerPoolRules,
    devyPlayerPoolRules: contract.devyPlayerPoolRules,
    rookiePlayerPoolRules: contract.rookiePlayerPoolRules,
    player_pool: contract.playerPoolRules.poolKey,
    startupDraftSettings: draftSettings.startupDraft,
    devyDraftSettings: draftSettings.devyDraft,
    rookieDraftSettings: draftSettings.rookieDraft,
    supplementalDraftSettings: draftSettings.supplementalDraft,
    rookieTransitionRules: {
      promotionTiming: devySettings.promotionTiming,
      graduatedToNFLHandling: 'move_to_taxi',
      graduatedPlayersExcludedFromActiveDevyPool: true,
      duplicateIdentityResolution: 'devy_player_mapping',
      returnToSchoolHandling: devySettings.returnToSchoolHandling,
    },
    tabsEnabled: contract.tabsEnabled,
    tabs_enabled: contract.tabsEnabled,
    mockDraftRules: contract.mockDraftRules,
    mock_draft_rules: contract.mockDraftRules,
    liveDraftRules: contract.liveDraftRules,
    live_draft_rules: contract.liveDraftRules,
    taxi: true,
    taxi_enabled: true,
    future_rookie_picks: true,
    future_rookie_picks_enabled: true,
    future_devy_picks: true,
    future_devy_picks_enabled: true,
    future_picks: true,
    future_picks_enabled: true,
    keeper_dynasty_carryover_supported: true,
    keeperDynastyCarryoverSupported: true,
    devy_college_slots_creation: rosterTemplate.devySlots,
    ...contract.disabledSettings,
    c2cConfig: { enabled: false },
    keeperSettings: { enabled: false },
    bestBallSettings: { enabled: false },
    salaryCapSettings: { enabled: false },
    contractSettings: { enabled: false },
  }
}

export function normalizeDevySettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
  settings?: Record<string, unknown> | null
}): Record<string, unknown> {
  const incoming = input.settings ?? {}
  const requestedDraftType = normalizeDevyDraftType(
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
    buildDevySettingsSnapshot({
      sport: input.sport,
      draftType: requestedDraftType,
      scoringPresetId,
      teamCount,
    }) ?? {}
  const merged: Record<string, unknown> = {
    ...defaults,
    ...incoming,
  }

  const draftSettings = (defaults.draftSettings as DevyDraftSettings | undefined) ?? null
  const rosterTemplate = defaults.rosterTemplate as DevyRosterTemplate | undefined
  const devySettings = defaults.devySettings as DevySettings | undefined

  merged.league_type = 'devy'
  merged.leagueType = 'devy'
  merged.roster_mode = 'dynasty'
  merged.isDynasty = true
  merged.isDevy = true
  merged.devy = true
  merged.devy_enabled = true
  merged.c2c = false
  merged.c2c_enabled = false
  merged.keeper = false
  merged.keeper_enabled = false
  merged.best_ball = false
  merged.best_ball_enabled = false
  merged.guillotine = false
  merged.guillotine_enabled = false
  merged.contracts = false
  merged.contracts_enabled = false
  merged.salary_cap = false
  merged.salary_cap_enabled = false

  merged.draft_type = draftSettings?.draftType ?? getDevyEngineDraftType(requestedDraftType)
  merged.requested_draft_type = requestedDraftType
  merged.draft_rounds = draftSettings?.rounds ?? defaults.draft_rounds
  merged.rounds = draftSettings?.rounds ?? defaults.rounds
  merged.draft_timer_seconds = draftSettings?.timerSeconds ?? defaults.draft_timer_seconds
  merged.timer_seconds = draftSettings?.timerSeconds ?? defaults.timer_seconds
  merged.draft_pick_order_rules = draftSettings?.pickOrderRules ?? defaults.draft_pick_order_rules
  merged.draft_snake_or_linear = draftSettings?.snakeOrLinear ?? defaults.draft_snake_or_linear
  merged.draft_same_order_every_round = draftSettings?.sameOrderEveryRound ?? defaults.draft_same_order_every_round
  merged.draft_third_round_reversal = false
  merged.third_round_reversal = false
  merged.draft_queue_size_limit = draftSettings?.queueSizeLimit ?? defaults.draft_queue_size_limit
  merged.queue_size_limit = draftSettings?.queueSizeLimit ?? defaults.queue_size_limit
  merged.draftSettings = draftSettings ?? defaults.draftSettings

  if (rosterTemplate) {
    merged.starter_slots = rosterTemplate.starterSlots
    merged.bench_slots = rosterTemplate.benchSlots
    merged.ir_slots = rosterTemplate.irSlots
    merged.taxi_slots = rosterTemplate.taxiSlots
    merged.taxiSlots = rosterTemplate.taxiSlots
    merged.devy_slots = rosterTemplate.devySlots
    merged.devySlots = rosterTemplate.devySlots
    merged.collegeRosterSlots = rosterTemplate.devySlots
    merged.rosterTemplate = rosterTemplate
    merged.rosterSettings = defaults.rosterSettings
  }

  merged.taxi = true
  merged.taxi_enabled = true
  merged.future_rookie_picks = true
  merged.future_rookie_picks_enabled = true
  merged.future_devy_picks = true
  merged.future_devy_picks_enabled = true
  merged.future_picks = true
  merged.future_picks_enabled = true
  merged.keeper_dynasty_carryover_supported = true
  merged.keeperDynastyCarryoverSupported = true
  merged.scoringSettings = {
    ...((defaults.scoringSettings as Record<string, unknown> | undefined) ?? {}),
    ...(isRecord(incoming.scoringSettings) ? incoming.scoringSettings : {}),
    dynasty: true,
    devy: true,
    c2c: false,
    bestBall: false,
    keeper: false,
  }
  merged.devySettings = devySettings ?? defaults.devySettings
  merged.devyConfig = defaults.devyConfig
  merged.c2cConfig = { ...(isRecord(incoming.c2cConfig) ? incoming.c2cConfig : {}), enabled: false }
  merged.keeperSettings = { ...(isRecord(incoming.keeperSettings) ? incoming.keeperSettings : {}), enabled: false }
  merged.bestBallSettings = { ...(isRecord(incoming.bestBallSettings) ? incoming.bestBallSettings : {}), enabled: false }
  merged.salaryCapSettings = { ...(isRecord(incoming.salaryCapSettings) ? incoming.salaryCapSettings : {}), enabled: false }
  merged.contractSettings = { ...(isRecord(incoming.contractSettings) ? incoming.contractSettings : {}), enabled: false }
  merged.playerPoolRules = defaults.playerPoolRules
  merged.player_pool_rules = defaults.player_pool_rules
  merged.proPlayerPoolRules = defaults.proPlayerPoolRules
  merged.devyPlayerPoolRules = defaults.devyPlayerPoolRules
  merged.rookiePlayerPoolRules = defaults.rookiePlayerPoolRules
  merged.tabsEnabled = defaults.tabsEnabled
  merged.tabs_enabled = defaults.tabs_enabled
  merged.mockDraftRules = defaults.mockDraftRules
  merged.mock_draft_rules = defaults.mock_draft_rules
  merged.liveDraftRules = defaults.liveDraftRules
  merged.live_draft_rules = defaults.live_draft_rules
  merged.tradeSettings = {
    ...((defaults.tradeSettings as Record<string, unknown> | undefined) ?? {}),
    ...(isRecord(incoming.tradeSettings) ? incoming.tradeSettings : {}),
    futureRookiePicksEnabled: true,
    futureDevyPicksEnabled: true,
    devyRightsTradeable: true,
  }

  if (typeof incoming.leagueName === 'string') merged.leagueName = incoming.leagueName
  if (typeof incoming.language === 'string') merged.language = incoming.language
  if (typeof incoming.timezone === 'string') merged.timezone = incoming.timezone

  const positions = rosterTemplate?.draftablePlayerPositions ?? []
  if (isRecord(merged.proPlayerPoolRules)) {
    merged.proPlayerPoolRules = {
      ...merged.proPlayerPoolRules,
      positions: unique(positions.map(String)),
    }
  }

  return merged
}
