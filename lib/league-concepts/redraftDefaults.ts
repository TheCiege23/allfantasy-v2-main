import type { LeagueSport } from '@prisma/client'

export type FootballRedraftSport = 'NFL' | 'NCAAF'
export type RedraftDraftType =
  | 'snake'
  | 'linear'
  | 'auction'
  | 'offline'
  | 'auto'
  | 'mock_draft'

export type RedraftDraftSurface = 'live' | 'mock'

type EngineDraftType = 'snake' | 'linear' | 'auction'
export type RedraftScoringPresetFormat = 'standard' | 'half_ppr' | 'ppr'
export type CanonicalRedraftSlotKey =
  | 'QB'
  | 'RB'
  | 'WR'
  | 'TE'
  | 'FLX'
  | 'SF'
  | 'DEF'
  | 'DL'
  | 'LB'
  | 'DB'
  | 'IDP'
  | 'BN'
  | 'IR'
  | 'K'

export interface CanonicalRedraftRosterSlot {
  key: CanonicalRedraftSlotKey
  display: string
  count: number
  starter: boolean
  optional: boolean
  eligiblePositions: string[]
  aliases: string[]
}

export interface RedraftRosterTemplate {
  rosterMode: 'redraft'
  starterSlots: Record<string, number>
  flexDefinitions: Array<{ slotName: string; allowedPositions: string[] }>
  benchSlots: number
  irSlots: number
  taxiSlots: 0
  keeperSlots: 0
  rosterSlots: number
  draftableRosterSlots: number
  totalRosterSlots: number
  rosterPositions: string[]
  starterSlotOrder: string[]
  rosterSlotOrder: string[]
  compactRosterSlotOrder: string[]
  draftablePlayerPositions: string[]
  defensePosition: 'DEF'
  positionAliases: Record<string, string[]>
  lineupValidationRules: Record<string, unknown>
}

export interface RedraftDraftSettings {
  draftType: EngineDraftType
  requestedDraftType: RedraftDraftType
  rounds: number
  fallbackRounds: number
  timerSeconds: number
  slowTimerSeconds: number
  pickOrderRules: 'snake' | 'linear'
  snakeOrLinear: 'snake' | 'linear'
  thirdRoundReversal: false
  autopickBehavior: 'queue-first'
  autopickBehaviorAlias: 'queue_first'
  queueSizeLimit: number
  preDraftRankingSource: string
  rosterFillOrder: string
  positionFilterBehavior: string
  auctionBudgetPerTeam: number | null
}

export interface RedraftDefaultContract {
  sport: FootballRedraftSport
  league_type: 'redraft'
  leagueType: 'redraft'
  draft_type: EngineDraftType
  requested_draft_type: RedraftDraftType
  teams: number
  rounds: number
  timer_seconds: number
  scoring_preset_id: string
  scoringPresetAliases: string[]
  roster_mode: 'redraft'
  rosterTemplate: RedraftRosterTemplate
  scoringSettings: Record<string, unknown>
  draftSettings: RedraftDraftSettings
  playerPoolRules: Record<string, unknown>
  tabsEnabled: Record<string, true | 'commissioner'>
  mockDraftRules: Record<string, unknown>
  liveDraftRules: Record<string, unknown>
  waiverSettings: Record<string, unknown>
  tradeSettings: Record<string, unknown>
  playoffSettings: Record<string, unknown>
  matchupSettings: Record<string, unknown>
  commissionerSettings: Record<string, unknown>
  dashboardSettings: Record<string, unknown>
  aiContextDefaults: Record<string, unknown>
  disabledSettings: Record<string, unknown>
}

export const REDRAFT_DRAFT_TYPE_IDS: readonly RedraftDraftType[] = [
  'snake',
  'linear',
  'auction',
  'offline',
  'auto',
  'mock_draft',
] as const

const DEFAULT_STARTER_ORDER = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLX', 'K', 'DEF'] as const
const OLD_NFL_STANDARD_STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 } as const
const OLD_NCAAF_STANDARD_STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 } as const

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

export function isFootballRedraftDefaultsSport(sport: unknown): sport is FootballRedraftSport {
  const normalized = String(sport ?? '').trim().toUpperCase()
  return normalized === 'NFL' || normalized === 'NCAAF'
}

export function normalizeRedraftDraftType(value: unknown): RedraftDraftType {
  const raw = String(value ?? '').trim().toLowerCase()
  const normalized =
    raw === 'mock'
      ? 'mock_draft'
      : raw === 'slow' || raw === 'slow_draft'
        ? 'snake'
        : raw

  return (REDRAFT_DRAFT_TYPE_IDS as readonly string[]).includes(normalized)
    ? (normalized as RedraftDraftType)
    : 'snake'
}

export function getRedraftEngineDraftType(draftType: unknown): EngineDraftType {
  const normalized = normalizeRedraftDraftType(draftType)
  if (normalized === 'auction') return 'auction'
  if (normalized === 'linear') return 'linear'
  return 'snake'
}

export function normalizeRedraftRosterSlotKey(value: unknown): CanonicalRedraftSlotKey | string {
  const raw = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '_')
  if (!raw) return ''
  if (raw === 'FLEX' || raw === 'FLEX_RB_WR_TE' || raw === 'RB/WR/TE') return 'FLX'
  if (raw === 'SUPERFLEX' || raw === 'SUPER_FLEX' || raw === 'SFLX' || raw === 'QB/RB/WR/TE') return 'SF'
  if (raw === 'D/ST' || raw === 'DST' || raw === 'DEFENSE') return 'DEF'
  if (raw === 'BENCH' || raw === 'BE') return 'BN'
  if (raw === 'IDP_FLEX' || raw === 'IDP-FLEX') return 'IDP'
  if (raw === 'IDP_DL' || raw === 'DE' || raw === 'DT') return 'DL'
  if (raw === 'IDP_LB' || raw === 'ILB' || raw === 'OLB') return 'LB'
  if (raw === 'IDP_DB' || raw === 'CB' || raw === 'S') return 'DB'
  return raw
}

function expandSlotCount(slotOrder: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const slot of slotOrder) {
    const key = normalizeRedraftRosterSlotKey(slot)
    if (key === 'BN' || key === 'IR') continue
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

export function getCanonicalRedraftRosterSlotOrder(input: {
  flexEnabled?: boolean
  superflexEnabled?: boolean
  idpEnabled?: boolean
  explicitIdpPositions?: boolean
  includeBench?: boolean
  includeIr?: boolean
} = {}): string[] {
  const order: string[] = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLX', 'K']
  if (input.superflexEnabled) order.push('SF')
  order.push('DEF')
  if (input.idpEnabled) {
    if (input.explicitIdpPositions) order.push('DL', 'LB', 'DB')
    order.push('IDP')
  }
  if (input.includeBench !== false) order.push('BN')
  if (input.includeIr) order.push('IR')
  return order
}

export function getCanonicalRedraftStarterSlots(input: {
  flexEnabled?: boolean
  superflexEnabled?: boolean
  idpEnabled?: boolean
  explicitIdpPositions?: boolean
} = {}): Record<string, number> {
  return expandSlotCount(
    getCanonicalRedraftRosterSlotOrder({
      ...input,
      includeBench: false,
      includeIr: false,
    }),
  )
}

export function isKnownLegacyRedraftStarterMap(
  sport: FootballRedraftSport,
  value: unknown,
): boolean {
  if (!isRecord(value)) return false
  const expected = sport === 'NCAAF' ? OLD_NCAAF_STANDARD_STARTERS : OLD_NFL_STANDARD_STARTERS
  const keys = Object.keys(value).sort()
  const expectedKeys = Object.keys(expected).sort()
  if (keys.length !== expectedKeys.length) return false
  return expectedKeys.every((key, index) => {
    if (keys[index] !== key) return false
    return Number(value[key]) === Number((expected as Record<string, number>)[key])
  })
}

function pickOrderForDraftType(draftType: unknown): 'snake' | 'linear' {
  return getRedraftEngineDraftType(draftType) === 'linear' ? 'linear' : 'snake'
}

function defaultScoringPresetId(sport: FootballRedraftSport): string {
  return sport === 'NCAAF' ? 'ncaaf_half_ppr' : 'fb_half_ppr'
}

function inferScoringPresetFormat(presetId: unknown): RedraftScoringPresetFormat {
  const raw = String(presetId ?? '').trim().toLowerCase()
  const alias = raw.replace(/[\s-]+/g, '_')
  if (!alias || alias === 'default') return 'half_ppr'
  if (
    alias === 'standard' ||
    alias === 'std' ||
    alias === 'fb_std' ||
    alias === 'fb_standard' ||
    alias === 'ncaaf_standard' ||
    alias === 'ncaaf_standard_college' ||
    alias === 'standard_college' ||
    alias.includes('standard')
  ) return 'standard'
  if (
    alias === 'ppr' ||
    alias === 'full_ppr' ||
    alias === 'fb_ppr' ||
    alias === 'fb_full_ppr' ||
    alias === 'ncaaf_ppr' ||
    alias === 'ncaaf_ppr_college' ||
    alias === 'ppr_college'
  ) return 'ppr'
  if (
    alias === 'half' ||
    alias === 'half_ppr' ||
    alias === 'fb_half_ppr' ||
    alias === 'ncaaf_half_ppr' ||
    alias === 'ncaaf_half_ppr_college' ||
    alias === 'half_ppr_college' ||
    alias.includes('half')
  ) return 'half_ppr'
  return alias.includes('ppr') ? 'ppr' : 'half_ppr'
}

export function resolveRedraftScoringPreset(input: {
  sport: LeagueSport | string
  presetId?: string | null
}): {
  presetId: string
  format: RedraftScoringPresetFormat
  ppr: number
  templateId: string
  aliases: string[]
} | null {
  const normalizedSport = String(input.sport ?? '').trim().toUpperCase()
  if (!isFootballRedraftDefaultsSport(normalizedSport)) return null
  const sport = normalizedSport
  const format = inferScoringPresetFormat(input.presetId)
  const presetId =
    sport === 'NCAAF'
      ? format === 'standard'
        ? 'ncaaf_standard'
        : format === 'ppr'
          ? 'ncaaf_ppr'
          : 'ncaaf_half_ppr'
      : format === 'standard'
        ? 'fb_standard'
        : format === 'ppr'
          ? 'fb_full_ppr'
          : 'fb_half_ppr'
  const ppr = format === 'standard' ? 0 : format === 'ppr' ? 1 : 0.5
  return {
    presetId,
    format,
    ppr,
    templateId: scoringTemplateId(sport, presetId),
    aliases: scoringAliasesForPreset(sport, presetId),
  }
}

function scoringPprValue(presetId: string): number {
  const format = inferScoringPresetFormat(presetId)
  return format === 'standard' ? 0 : format === 'ppr' ? 1 : 0.5
}

function scoringFormatForPreset(presetId: string): string {
  return inferScoringPresetFormat(presetId)
}

function scoringTemplateId(sport: FootballRedraftSport, presetId: string): string {
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

function scoringAliasesForPreset(sport: FootballRedraftSport, presetId: string): string[] {
  const format = scoringFormatForPreset(presetId)
  if (sport === 'NCAAF') {
    if (format === 'standard') return ['standard', 'standard_college', 'ncaaf_standard_college']
    if (format === 'ppr') return ['ppr', 'full_ppr', 'ppr_college', 'ncaaf_ppr_college']
    return ['half_ppr', 'half_ppr_college', 'ncaaf_half_ppr_college']
  }
  if (format === 'standard') return ['standard', 'fb_std']
  if (format === 'ppr') return ['ppr', 'full_ppr', 'fb_ppr']
  return ['half_ppr']
}

function buildRosterTemplate(sport: FootballRedraftSport): RedraftRosterTemplate {
  const starterSlotOrder = [...DEFAULT_STARTER_ORDER]
  const starterSlots = getCanonicalRedraftStarterSlots()
  const rosterPositions = getCanonicalRedraftRosterSlotOrder({ includeIr: true })
  const compactRosterSlotOrder = getCanonicalRedraftRosterSlotOrder()
  const draftablePlayerPositions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
  const benchSlots = sport === 'NCAAF' ? 8 : 6
  const irSlots = 1
  const rosterSlots = starterCount(starterSlots)

  return {
    rosterMode: 'redraft',
    starterSlots,
    flexDefinitions: [
      { slotName: 'FLX', allowedPositions: ['RB', 'WR', 'TE'] },
      { slotName: 'SF', allowedPositions: ['QB', 'RB', 'WR', 'TE'] },
    ],
    benchSlots,
    irSlots,
    taxiSlots: 0,
    keeperSlots: 0,
    rosterSlots,
    draftableRosterSlots: rosterSlots + benchSlots,
    totalRosterSlots: rosterSlots + benchSlots + irSlots,
    rosterPositions,
    starterSlotOrder,
    rosterSlotOrder: [
      ...starterSlotOrder,
      ...Array.from({ length: benchSlots }, () => 'BN'),
      ...Array.from({ length: irSlots }, () => 'IR'),
    ],
    compactRosterSlotOrder,
    draftablePlayerPositions,
    defensePosition: 'DEF',
    positionAliases: {
      FLX: ['FLEX'],
      SF: ['SUPERFLEX', 'SUPER_FLEX'],
      DEF: ['DST', 'D/ST', 'DEFENSE'],
      K: ['PK', 'KICKER'],
      BN: ['BENCH'],
      IDP: ['IDP_FLEX'],
    },
    lineupValidationRules: {
      requiredPositions: ['QB', 'RB', 'WR', 'TE', 'FLX', 'K', 'DEF'],
      enforceStarterCapacity: true,
      enforceSlotEligibility: true,
      lockedPlayerMovesBlocked: true,
      byeWeekStartersBlocked: true,
      outOrIrStartersBlocked: true,
      injuryWarningStatuses: ['QUESTIONABLE', 'DOUBTFUL'],
    },
  }
}

function buildScoringSettings(
  sport: FootballRedraftSport,
  scoringPresetId: string,
): Record<string, unknown> {
  const resolved = resolveRedraftScoringPreset({ sport, presetId: scoringPresetId })
  const format = resolved?.format ?? 'half_ppr'
  const ppr = resolved?.ppr ?? scoringPprValue(scoringPresetId)

  return {
    source: 'af',
    sport,
    preset: resolved?.presetId ?? scoringPresetId,
    scoringPresetId: resolved?.presetId ?? scoringPresetId,
    scoringTemplateId: resolved?.templateId ?? scoringTemplateId(sport, scoringPresetId),
    scoringMode: 'points',
    scoringFormat: sport === 'NCAAF' ? `${format}_college` : format,
    format,
    ppr,
    superflex: false,
    tePremium: false,
    tePremiumMultiplier: 1,
    idp: false,
    kickerEnabled: true,
    defenseEnabled: true,
    rules: {
      ppr,
      passingYards: 0.04,
      passingTouchdown: 4,
      interceptionThrown: -2,
      rushingYards: 0.1,
      rushingTouchdown: 6,
      receivingYards: 0.1,
      receivingTouchdown: 6,
      fumbleLost: -2,
      twoPointConversion: 2,

      fieldGoalMade0To19: 3,
      fieldGoalMade20To29: 3,
      fieldGoalMade30To39: 3,
      fieldGoalMade40To49: 4,
      fieldGoalMade50Plus: 5,
      extraPointMade: 1,
      fieldGoalMissed0To19: -1,
      fieldGoalMissed20To29: -1,
      extraPointMissed: -1,

      teamDefenseTouchdown: 6,
      teamDefenseInterception: 2,
      teamDefenseFumbleRecovery: 2,
      teamDefenseSack: 1,
      teamDefenseSafety: 2,
      teamDefenseBlockedKick: 2,
      teamDefensePointsAllowed0: 10,
      teamDefensePointsAllowed1To6: 7,
      teamDefensePointsAllowed7To13: 4,
      teamDefensePointsAllowed14To20: 1,
      teamDefensePointsAllowed21To27: 0,
      teamDefensePointsAllowed28To34: -1,
      teamDefensePointsAllowed35Plus: -4,

      idp: false,
    },
  }
}

function buildDraftSettings(
  sport: FootballRedraftSport,
  draftType: RedraftDraftType,
  rosterTemplate: RedraftRosterTemplate,
): RedraftDraftSettings {
  const engineDraftType = getRedraftEngineDraftType(draftType)
  const pickOrderRules = pickOrderForDraftType(draftType)

  return {
    draftType: engineDraftType,
    requestedDraftType: draftType,
    rounds: rosterTemplate.draftableRosterSlots,
    fallbackRounds: sport === 'NCAAF' ? 17 : 15,
    timerSeconds: 90,
    slowTimerSeconds: 28_800,
    pickOrderRules,
    snakeOrLinear: pickOrderRules,
    thirdRoundReversal: false,
    autopickBehavior: 'queue-first',
    autopickBehaviorAlias: 'queue_first',
    queueSizeLimit: sport === 'NCAAF' ? 70 : 50,
    preDraftRankingSource: sport === 'NCAAF' ? 'adp_projection_rank_fallback' : 'adp',
    rosterFillOrder: sport === 'NCAAF' ? 'position_scarcity' : 'starter_first',
    positionFilterBehavior: 'by_eligibility',
    auctionBudgetPerTeam: engineDraftType === 'auction' ? 200 : null,
  }
}

function buildPlayerPoolRules(
  sport: FootballRedraftSport,
  rosterTemplate: RedraftRosterTemplate,
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
      excludeRookieOnlyPool: true,
      positions,
      positionAliases: {
        DEF: ['DST', 'D/ST'],
        FLX: ['FLEX'],
        SF: ['SUPERFLEX', 'SUPER_FLEX'],
        K: ['PK', 'KICKER'],
      },
      rankingSource: 'adp_projection_rank_fallback',
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
    positionAliases: {
      DEF: ['DST', 'D/ST'],
      FLX: ['FLEX'],
      SF: ['SUPERFLEX', 'SUPER_FLEX'],
      K: ['PK', 'KICKER'],
    },
    rankingSource: 'adp',
  }
}

function buildDisabledSettings(): Record<string, unknown> {
  return {
    taxi: false,
    taxi_slots: 0,
    taxiSlots: 0,
    keepers: false,
    keepers_enabled: false,
    keeper_carryover_enabled: false,
    devy: false,
    devy_enabled: false,
    c2c: false,
    c2c_enabled: false,
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
    waivers: true,
    trade_center: true,
    war_room: true,
    settings: 'commissioner',
    commissioner_tools: 'commissioner',
  }
}

function buildSurfaceRules(
  surface: RedraftDraftSurface,
  draftSettings: RedraftDraftSettings,
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
  }
}

function buildWaiverSettings(sport: FootballRedraftSport): Record<string, unknown> {
  return {
    enabled: true,
    waiverSystemEnabled: true,
    freeAgencyEnabled: true,
    waiverMode: 'faab',
    waiverType: 'faab',
    faabSupported: true,
    faabBudget: 100,
    prioritySupported: true,
    claimEditingBeforeDeadline: true,
    claimCancellationBeforeDeadline: true,
    processingDayOfWeek: 2,
    processingTimeUtc: '10:00',
    commissionerOverride: true,
    rosterLegalityAfterClaim: true,
    lockedPlayerProtection: true,
    aiRecommendationsRequired: false,
    sport,
  }
}

function buildTradeSettings(sport: FootballRedraftSport): Record<string, unknown> {
  return {
    enabled: true,
    tradeCenterEnabled: true,
    reviewMode: 'commissioner',
    commissionerReviewEnabled: true,
    commissionerVetoEnabled: true,
    leagueVoteEnabled: false,
    reviewPeriodHours: 24,
    tradeDeadlineWeek: sport === 'NCAAF' ? 9 : 11,
    rosterLegalityValidation: true,
    tradeHistoryAudit: true,
    draftPickTradingEnabled: false,
    redraftDraftAssetsEnabled: false,
    dynastyValueHidden: true,
    dynastyLanguageHidden: true,
    aiTradeAnalyzerRequired: false,
    aiTradeAnalyzerPremiumAware: true,
  }
}

/**
 * A bracket can never seat more teams than the league has. The persisted
 * `League.playoffTeams` column is clamped in
 * `createCanonicalLeagueInTransaction`; this keeps the advertised settings JSON
 * agreeing with it, so the two records cannot tell a commissioner different
 * things about the same league.
 */
function derivePlayoffTeams(teamCount: number): number {
  const seats = Math.max(2, Math.floor(teamCount) || 2)
  const target = seats >= 10 ? 6 : 4
  const fitted = Math.min(target, seats)
  return fitted % 2 === 0 ? fitted : fitted - 1
}

function buildPlayoffSettings(sport: FootballRedraftSport, teamCount: number): Record<string, unknown> {
  return {
    enabled: true,
    regularSeasonStartWeek: 1,
    regularSeasonEndWeek: sport === 'NCAAF' ? 12 : 14,
    playoffTeams: derivePlayoffTeams(teamCount),
    playoffStartWeek: sport === 'NCAAF' ? 13 : 15,
    championshipWeek: sport === 'NCAAF' ? 14 : 17,
    playoffWeeksPerRound: 1,
    topSeedByes: teamCount >= 10,
    tiebreakers: ['points_for', 'head_to_head', 'division_record'],
    standingsRule: 'record_then_points_for',
    lowerBracket: 'consolation',
  }
}

function buildMatchupSettings(sport: FootballRedraftSport): Record<string, unknown> {
  return {
    matchupGenerationStrategy: 'balanced_round_robin',
    scheduleGenerated: false,
    safeEmptyState: true,
    commissionerGenerateScheduleAction: true,
    currentPhase: 'pre_draft',
    scoringPeriodType: 'weekly',
    sport,
  }
}

function buildCommissionerSettings(): Record<string, unknown> {
  return {
    editLeagueSettings: true,
    manageTeams: true,
    inviteManagers: true,
    removeManagers: true,
    setDraftOrder: true,
    openDraftSetup: true,
    pauseResumeDraft: true,
    undoPick: true,
    forcePick: true,
    skipPick: true,
    manageWaivers: true,
    processWaivers: true,
    approveTrades: true,
    vetoTrades: true,
    adjustRoster: true,
    generateSchedule: true,
    lockTeams: true,
    unlockTeams: true,
    publishAnnouncement: true,
    aiCommissionerAssistantEnabled: false,
    inactivityMonitoringEnabled: false,
    invalidLineupRemindersEnabled: false,
    waiverDeadlineRemindersEnabled: false,
    tradeReviewAiFlaggingEnabled: false,
    orphanTeamAiManagerEnabled: false,
    weeklyCommissionerBriefEnabled: false,
    leagueHealthScoreEnabled: true,
    aiAutomationMode: 'recommendation_only',
  }
}

function buildDashboardSettings(): Record<string, unknown> {
  return {
    preDraftActions: ['set_draft_date', 'open_draft_settings', 'start_mock_draft', 'open_live_draft_room'],
    postDraftCards: ['current_week', 'my_matchup', 'lineup_status', 'waiver_deadline', 'pending_trades', 'standings_snapshot'],
    desktopPanelRatio: { chat: 40, dashboard: 35, sidebar: 25 },
    chatCollapsible: true,
    sidebarCollapsible: true,
    mobileLayout: 'stacked_tabs',
    providerDataRequiredToRender: false,
  }
}

function buildAiContextDefaults(sport: FootballRedraftSport): Record<string, unknown> {
  return {
    sport,
    leagueType: 'redraft',
    leaguePhase: 'pre_draft',
    includesScoringPreset: true,
    includesRosterSlots: true,
    includesDraftStatus: true,
    includesWaiverSettings: true,
    includesTradeSettings: true,
    includesPlayoffSettings: true,
    providerDataAvailability: 'unavailable_until_synced',
    dataFallbackPolicy: 'state_unavailable_do_not_invent',
    aiRequiredForBaseFlow: false,
    warRoomSafeEmptyContext: true,
    chimmySafeEmptyContext: true,
    premiumFeaturesOptional: true,
  }
}

export function getRedraftDefaultContract(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): RedraftDefaultContract | null {
  const normalizedSport = String(input.sport ?? '').trim().toUpperCase()
  if (!isFootballRedraftDefaultsSport(normalizedSport)) return null

  const sport = normalizedSport
  const requestedDraftType = normalizeRedraftDraftType(input.draftType)
  const rosterTemplate = buildRosterTemplate(sport)
  const draftSettings = buildDraftSettings(sport, requestedDraftType, rosterTemplate)
  const scoringPresetId =
    typeof input.scoringPresetId === 'string' && input.scoringPresetId.trim()
      ? input.scoringPresetId.trim()
      : defaultScoringPresetId(sport)
  const resolvedScoring = resolveRedraftScoringPreset({ sport, presetId: scoringPresetId })
  const canonicalScoringPresetId = resolvedScoring?.presetId ?? scoringPresetId
  const scoringSettings = buildScoringSettings(sport, canonicalScoringPresetId)
  const playerPoolRules = buildPlayerPoolRules(sport, rosterTemplate)
  const tabsEnabled = buildTabsEnabled()
  const disabledSettings = buildDisabledSettings()
  const waiverSettings = buildWaiverSettings(sport)
  const tradeSettings = buildTradeSettings(sport)
  const playoffSettings = buildPlayoffSettings(sport, asPositiveInt(input.teamCount, 12))
  const matchupSettings = buildMatchupSettings(sport)
  const commissionerSettings = buildCommissionerSettings()
  const dashboardSettings = buildDashboardSettings()
  const aiContextDefaults = buildAiContextDefaults(sport)

  return {
    sport,
    league_type: 'redraft',
    leagueType: 'redraft',
    draft_type: draftSettings.draftType,
    requested_draft_type: requestedDraftType,
    teams: asPositiveInt(input.teamCount, 12),
    rounds: draftSettings.rounds,
    timer_seconds: draftSettings.timerSeconds,
    scoring_preset_id: canonicalScoringPresetId,
    scoringPresetAliases: resolvedScoring?.aliases ?? scoringAliasesForPreset(sport, canonicalScoringPresetId),
    roster_mode: 'redraft',
    rosterTemplate,
    scoringSettings,
    draftSettings,
    playerPoolRules,
    tabsEnabled,
    mockDraftRules: buildSurfaceRules('mock', draftSettings),
    liveDraftRules: buildSurfaceRules('live', draftSettings),
    waiverSettings,
    tradeSettings,
    playoffSettings,
    matchupSettings,
    commissionerSettings,
    dashboardSettings,
    aiContextDefaults,
    disabledSettings,
  }
}

export function getRedraftDraftSettingsForSurface(
  contract: RedraftDefaultContract,
  surface: RedraftDraftSurface,
): RedraftDraftSettings {
  const surfaceRules = surface === 'mock' ? contract.mockDraftRules : contract.liveDraftRules
  return {
    ...contract.draftSettings,
    draftType: surfaceRules.draftType as EngineDraftType,
    requestedDraftType: surfaceRules.requestedDraftType as RedraftDraftType,
  }
}

export function buildRedraftSettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): Record<string, unknown> | null {
  const contract = getRedraftDefaultContract(input)
  if (!contract) return null

  const { draftSettings, rosterTemplate } = contract

  return {
    redraftDefaultsVersion: 3,
    sport: contract.sport,
    sport_type: contract.sport,
    leagueType: 'redraft',
    league_type: 'redraft',
    roster_mode: 'redraft',
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
    roster_size: rosterTemplate.draftableRosterSlots,
    rosterSize: rosterTemplate.draftableRosterSlots,
    starter_slots: rosterTemplate.starterSlots,
    starter_slot_order: rosterTemplate.starterSlotOrder,
    roster_slot_order: rosterTemplate.rosterSlotOrder,
    compact_roster_slot_order: rosterTemplate.compactRosterSlotOrder,
    bench_slots: rosterTemplate.benchSlots,
    ir_slots: rosterTemplate.irSlots,
    taxi_slots: 0,
    rosterTemplate,
    rosterSettings: {
      rosterMode: 'redraft',
      starterSlots: rosterTemplate.starterSlots,
      flexDefinitions: rosterTemplate.flexDefinitions,
      benchSlots: rosterTemplate.benchSlots,
      irSlots: rosterTemplate.irSlots,
      taxiSlots: 0,
      rosterSlots: rosterTemplate.rosterSlots,
      rosterSize: rosterTemplate.draftableRosterSlots,
      rosterPositions: rosterTemplate.rosterPositions,
      starterSlotOrder: rosterTemplate.starterSlotOrder,
      rosterSlotOrder: rosterTemplate.rosterSlotOrder,
      compactRosterSlotOrder: rosterTemplate.compactRosterSlotOrder,
      draftablePlayerPositions: rosterTemplate.draftablePlayerPositions,
      positionAliases: rosterTemplate.positionAliases,
      lineupValidationRules: rosterTemplate.lineupValidationRules,
    },
    scoringSettings: contract.scoringSettings,
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
    waiverSettings: contract.waiverSettings,
    waiver_settings: contract.waiverSettings,
    tradeSettings: contract.tradeSettings,
    trade_settings: contract.tradeSettings,
    playoffSettings: contract.playoffSettings,
    playoff_settings: contract.playoffSettings,
    matchupSettings: contract.matchupSettings,
    matchup_settings: contract.matchupSettings,
    commissionerSettings: contract.commissionerSettings,
    commissioner_settings: contract.commissionerSettings,
    dashboardSettings: contract.dashboardSettings,
    dashboard_settings: contract.dashboardSettings,
    aiContextDefaults: contract.aiContextDefaults,
    ai_context_defaults: contract.aiContextDefaults,
    lineupValidationRules: rosterTemplate.lineupValidationRules,
    leaguePhase: 'pre_draft',
    league_phase: 'pre_draft',
    draftShell: {
      status: 'pre_draft',
      sessionKind: 'live',
      draftBoardShell: true,
      mockDraftEntryAvailable: true,
      liveDraftSetupAvailable: true,
      draftDateRequiredForSetup: false,
    },
    draft_shell: {
      status: 'pre_draft',
      sessionKind: 'live',
      draftBoardShell: true,
      mockDraftEntryAvailable: true,
      liveDraftSetupAvailable: true,
      draftDateRequiredForSetup: false,
    },
    ...contract.disabledSettings,
    devyConfig: { enabled: false },
    c2cConfig: { enabled: false },
    keeperSettings: { enabled: false },
    salaryCapSettings: { enabled: false },
    contractSettings: { enabled: false },
  }
}

export function normalizeRedraftSettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
  settings?: Record<string, unknown> | null
}): Record<string, unknown> {
  const incoming = input.settings ?? {}
  const requestedDraftType = normalizeRedraftDraftType(
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
    buildRedraftSettingsSnapshot({
      sport: input.sport,
      draftType: requestedDraftType,
      scoringPresetId,
      teamCount,
    }) ?? {}
  const resolvedScoringPresetId =
    typeof scoringPresetId === 'string' && scoringPresetId.trim()
      ? (resolveRedraftScoringPreset({ sport: input.sport, presetId: scoringPresetId })?.presetId ?? scoringPresetId.trim())
      : String(defaults.scoring_preset_id ?? '')

  const merged: Record<string, unknown> = {
    ...defaults,
    ...incoming,
  }

  const draftSettings = isRecord(incoming.draftSettings) ? incoming.draftSettings : {}
  const defaultDraftSettings = (defaults.draftSettings as RedraftDraftSettings | undefined) ?? null
  const defaultRounds = defaultDraftSettings?.rounds ?? asPositiveInt(defaults.draft_rounds, 15)
  const defaultTimer = defaultDraftSettings?.timerSeconds ?? 90
  const defaultSlowTimer = defaultDraftSettings?.slowTimerSeconds ?? 28_800
  const rounds = asPositiveInt(merged.draft_rounds ?? draftSettings.rounds, defaultRounds)
  const timerSeconds = asPositiveInt(merged.draft_timer_seconds ?? draftSettings.timerSeconds, defaultTimer)
  const queueSizeLimit = asPositiveInt(
    merged.draft_queue_size_limit ?? draftSettings.queueSizeLimit,
    defaultDraftSettings?.queueSizeLimit ?? 50,
  )
  const engineDraftType = getRedraftEngineDraftType(requestedDraftType)
  const pickOrderRules = pickOrderForDraftType(requestedDraftType)

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
  merged.draft_pick_order_rules = pickOrderRules
  merged.draft_snake_or_linear = pickOrderRules
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
      : defaultDraftSettings?.rosterFillOrder ?? 'starter_first'
  merged.draft_position_filter_behavior =
    typeof merged.draft_position_filter_behavior === 'string' && merged.draft_position_filter_behavior.trim()
      ? merged.draft_position_filter_behavior
      : defaultDraftSettings?.positionFilterBehavior ?? 'by_eligibility'
  merged.scoring_preset_id = resolvedScoringPresetId
  merged.scoringPreset = resolvedScoringPresetId
  merged.scoring_template_id = defaults.scoring_template_id
  merged.scoring_format = defaults.scoring_format
  merged.scoring_mode = 'points'

  const defaultRosterTemplate = defaults.rosterTemplate as RedraftRosterTemplate | undefined
  merged.roster_mode = 'redraft'
  merged.league_type = 'redraft'
  merged.leagueType = 'redraft'
  merged.starter_slots = defaultRosterTemplate?.starterSlots ?? merged.starter_slots
  merged.starter_slot_order = defaultRosterTemplate?.starterSlotOrder ?? merged.starter_slot_order
  merged.roster_slot_order = defaultRosterTemplate?.rosterSlotOrder ?? merged.roster_slot_order
  merged.compact_roster_slot_order = defaultRosterTemplate?.compactRosterSlotOrder ?? merged.compact_roster_slot_order
  merged.bench_slots = defaultRosterTemplate?.benchSlots ?? merged.bench_slots
  merged.ir_slots = defaultRosterTemplate?.irSlots ?? merged.ir_slots
  merged.taxi_slots = 0
  merged.taxiSlots = 0
  merged.taxi = false
  merged.keepers = false
  merged.keepers_enabled = false
  merged.keeper_carryover_enabled = false
  merged.devy = false
  merged.devy_enabled = false
  merged.c2c = false
  merged.c2c_enabled = false
  merged.contracts = false
  merged.contracts_enabled = false
  merged.salary_cap = false
  merged.salary_cap_enabled = false
  merged.rookie_only = false
  merged.rookie_only_pool = false
  merged.isDynasty = false

  merged.draftSettings = {
    ...(defaultDraftSettings ?? {}),
    ...draftSettings,
    draftType: engineDraftType,
    requestedDraftType,
    rounds,
    timerSeconds,
    slowTimerSeconds: merged.draft_slow_timer_seconds,
    pickOrderRules,
    snakeOrLinear: pickOrderRules,
    thirdRoundReversal: false,
    queueSizeLimit,
    autopickBehavior: merged.draft_autopick_behavior,
    preDraftRankingSource: merged.draft_pre_draft_ranking_source,
    rosterFillOrder: merged.draft_roster_fill_order,
    positionFilterBehavior: merged.draft_position_filter_behavior,
    auctionBudgetPerTeam: engineDraftType === 'auction' ? 200 : null,
  }
  merged.scoringSettings = {
    ...((defaults.scoringSettings as Record<string, unknown> | undefined) ?? {}),
    ...(isRecord(incoming.scoringSettings) ? incoming.scoringSettings : {}),
    preset: resolvedScoringPresetId,
    scoringPresetId: resolvedScoringPresetId,
    scoringTemplateId: defaults.scoring_template_id,
    scoringMode: 'points',
    kickerEnabled: true,
    defenseEnabled: true,
  }
  merged.rosterTemplate = defaultRosterTemplate
  merged.rosterSettings = defaults.rosterSettings
  merged.playerPoolRules = {
    ...(defaults.playerPoolRules as Record<string, unknown> | undefined),
    ...(isRecord(incoming.playerPoolRules) ? incoming.playerPoolRules : {}),
    sport: defaults.sport,
    includeNflPlayers: defaults.sport === 'NFL',
    includeCollegePlayers: defaults.sport === 'NCAAF',
    collegeOnly: defaults.sport === 'NCAAF',
    rookieOnly: false,
    excludeRookieOnlyPool: true,
    positions: unique(
      ((defaultRosterTemplate?.draftablePlayerPositions ?? []) as string[]).map((position) => String(position)),
    ),
  }
  merged.player_pool_rules = merged.playerPoolRules
  merged.devyConfig = { ...(isRecord(incoming.devyConfig) ? incoming.devyConfig : {}), enabled: false }
  merged.c2cConfig = { ...(isRecord(incoming.c2cConfig) ? incoming.c2cConfig : {}), enabled: false }
  merged.keeperSettings = { ...(isRecord(incoming.keeperSettings) ? incoming.keeperSettings : {}), enabled: false }
  merged.salaryCapSettings = { ...(isRecord(incoming.salaryCapSettings) ? incoming.salaryCapSettings : {}), enabled: false }
  merged.contractSettings = { ...(isRecord(incoming.contractSettings) ? incoming.contractSettings : {}), enabled: false }
  merged.tabsEnabled = defaults.tabsEnabled
  merged.tabs_enabled = defaults.tabs_enabled
  merged.mockDraftRules = buildSurfaceRules('mock', merged.draftSettings as RedraftDraftSettings)
  merged.mock_draft_rules = merged.mockDraftRules
  merged.liveDraftRules = buildSurfaceRules('live', merged.draftSettings as RedraftDraftSettings)
  merged.live_draft_rules = merged.liveDraftRules
  merged.waiverSettings = {
    ...((defaults.waiverSettings as Record<string, unknown> | undefined) ?? {}),
    ...(isRecord(incoming.waiverSettings) ? incoming.waiverSettings : {}),
  }
  merged.waiver_settings = merged.waiverSettings
  merged.tradeSettings = {
    ...((defaults.tradeSettings as Record<string, unknown> | undefined) ?? {}),
    ...(isRecord(incoming.tradeSettings) ? incoming.tradeSettings : {}),
  }
  merged.trade_settings = merged.tradeSettings
  merged.playoffSettings = {
    ...((defaults.playoffSettings as Record<string, unknown> | undefined) ?? {}),
    ...(isRecord(incoming.playoffSettings) ? incoming.playoffSettings : {}),
  }
  merged.playoff_settings = merged.playoffSettings
  merged.matchupSettings = {
    ...((defaults.matchupSettings as Record<string, unknown> | undefined) ?? {}),
    ...(isRecord(incoming.matchupSettings) ? incoming.matchupSettings : {}),
  }
  merged.matchup_settings = merged.matchupSettings
  merged.commissionerSettings = {
    ...((defaults.commissionerSettings as Record<string, unknown> | undefined) ?? {}),
    ...(isRecord(incoming.commissionerSettings) ? incoming.commissionerSettings : {}),
  }
  merged.commissioner_settings = merged.commissionerSettings
  merged.dashboardSettings = {
    ...((defaults.dashboardSettings as Record<string, unknown> | undefined) ?? {}),
    ...(isRecord(incoming.dashboardSettings) ? incoming.dashboardSettings : {}),
  }
  merged.dashboard_settings = merged.dashboardSettings
  merged.aiContextDefaults = {
    ...((defaults.aiContextDefaults as Record<string, unknown> | undefined) ?? {}),
    ...(isRecord(incoming.aiContextDefaults) ? incoming.aiContextDefaults : {}),
  }
  merged.ai_context_defaults = merged.aiContextDefaults
  merged.lineupValidationRules = {
    ...((defaults.lineupValidationRules as Record<string, unknown> | undefined) ?? {}),
    ...(isRecord(incoming.lineupValidationRules) ? incoming.lineupValidationRules : {}),
  }
  merged.leaguePhase = typeof incoming.leaguePhase === 'string' ? incoming.leaguePhase : 'pre_draft'
  merged.league_phase = typeof incoming.league_phase === 'string' ? incoming.league_phase : merged.leaguePhase
  merged.draftShell = {
    ...((defaults.draftShell as Record<string, unknown> | undefined) ?? {}),
    ...(isRecord(incoming.draftShell) ? incoming.draftShell : {}),
  }
  merged.draft_shell = merged.draftShell

  return merged
}