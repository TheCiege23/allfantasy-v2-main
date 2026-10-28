/**
 * Canonical Survivor league defaults for NFL, NCAAF, NBA, NHL and MLB creation. Follows the redraft/dynasty/tournament pattern.
 *
 * Survivor is a progressive-elimination format layered on top of redraft fantasy.
 * Each "week" is a scoring period. Tribes compete in weekly challenges. The losing
 * tribe holds tribal council and votes someone out. After merge, individuals vote.
 * Hidden idols, exile island, tokens, and rocks add strategic depth.
 *
 * PHASE 1 SCOPE — this module covers:
 *   - canonical settings snapshot and validation
 *   - tribe / merge defaults
 *   - weekly challenge defaults (automation: pending)
 *   - tribal council / voting defaults (automation: pending)
 *   - exile island defaults (automation: pending)
 *   - hidden idol defaults (automation: pending)
 *   - token economy defaults (automation: pending)
 *   - concept preset wiring
 *   - safe UI flags / tabs
 *   - creation snapshot with survivor_structure
 *
 * PHASE 2 (not in this module):
 *   - weekly challenge finalization engine
 *   - immunity assignment engine
 *   - tribal council vote-casting and reveal workflow
 *   - revote / rocks resolution engine
 *   - exile island selection and effects engine
 *   - idol search / clue engine and idol inventory
 *   - token ledger and token shop / advantage purchases
 *   - merge transition automation
 *   - jury / final tribal mechanics
 *   - public Survivor league landing / share pages
 *
 * Cast / structure rationale:
 *   NFL:   16 cast (2 tribes × 8), merge at 8, ~17 fantasy weeks → safe room for tribal pre-merge
 *   NCAAF: 14 cast (2 tribes × 7), merge at 7, ~14 college weeks → mirrors season length
 */
import { NEW_LEAGUE_EXILE_BOSS_MODE } from '@/lib/survivor/lateSeasonSettings'
import { survivorCouncilDefaultsForSport } from '@/lib/survivor/survivorCouncilDefaults'
import type { LeagueSport } from '@prisma/client'
import { getScoringDefaults } from '@/lib/sport-defaults/SportDefaultsRegistry'
import {
  SURVIVOR_CANONICAL_DRAFT_TYPE_IDS,
  SURVIVOR_DEFAULT_FOUNDATION_SETTINGS,
  buildSurvivorSettingsSnapshotPatch,
} from '@/lib/survivor/survivorSettings'

// ── Types ─────────────────────────────────────────────────────────────────────

export type SurvivorEligibleSport = 'NFL' | 'NCAAF' | 'NBA' | 'NHL' | 'MLB'

export const SURVIVOR_DRAFT_TYPE_IDS = SURVIVOR_CANONICAL_DRAFT_TYPE_IDS
export type SurvivorDraftType = (typeof SURVIVOR_DRAFT_TYPE_IDS)[number]

/** What the draft engine runs. An execution mode (offline, auto) runs as a snake draft underneath. */
type EngineDraftType = 'snake' | 'linear' | 'auction'

export type SurvivorPhase =
  | 'setup'
  | 'registration'
  | 'drafting'
  | 'pre_merge'
  | 'post_merge'
  | 'finale'
  | 'complete'

export type AutomationStatus = 'not_started' | 'pending' | 'active' | 'finalized'
export type TribeAssignmentMode = 'random' | 'snake_draft' | 'commissioner' | 'draft_pattern' | 'commissioner_manual'
export type ChallengeType = 'tribe_score' | 'individual_score' | 'commissioner_assigned'
export type ChallengeSource = 'fantasy_points_for' | 'commissioner_assigned'
export type VotingMode = 'tribe_vote' | 'individual_vote'
export type VoteVisibility = 'hidden_until_reveal' | 'public'
export type TieResolution = 'revote' | 'rocks' | 'rocks_after_revote' | 'commissioner'
export type ExileSelectionMode = 'voted_out' | 'challenge_loser_chooses' | 'random_non_immune' | 'commissioner'
export type IdolPlayWindow = 'before_vote_reveal' | 'after_votes_cast'
export type LedgerStatus = 'not_started' | 'pending' | 'active'

// ── Survivor-specific structures ──────────────────────────────────────────────

export interface SurvivorTribeSettings {
  tribeCount: number
  tribeAssignmentMode: TribeAssignmentMode
  mergeAtCount: number
  castSize: number
  commissionerPlays: boolean
  rocksEnabled: boolean
}

export interface SurvivorChallengeSettings {
  weeklyChallengeSEnabled: boolean
  challengeAutomationStatus: AutomationStatus
  preMergeChallengeType: ChallengeType
  postMergeChallengeType: ChallengeType
  challengeScoringSource: ChallengeSource
  immunityEnabled: boolean
  immunityWinnerNote: string
}

export interface SurvivorVotingSettings {
  tribalCouncilEnabled: boolean
  votingAutomationStatus: AutomationStatus
  preMergeVotingMode: VotingMode
  postMergeVotingMode: VotingMode
  eliminationsPerCycle: number
  voteVisibility: VoteVisibility
  tieResolution: TieResolution
  commissionerOverrideStatus: AutomationStatus
}

export interface SurvivorExileSettings {
  exileEnabled: boolean
  exileAutomationStatus: AutomationStatus
  exileSelectionMode: ExileSelectionMode
  exileDurationPeriods: number
  exileEffects: {
    cannotVote: boolean
    stillScoresFantasyPoints: boolean
    receivesClueOrToken: boolean
  }
}

export interface SurvivorIdolSettings {
  idolsEnabled: boolean
  idolCount: number
  idolPlayWindow: IdolPlayWindow
  idolEffect: string
  idolSearchAutomationStatus: AutomationStatus
  idolInventoryStatus: LedgerStatus
}

export interface SurvivorTokenSettings {
  tokensEnabled: boolean
  startingTokenBalance: number
  tokenEarningRules: {
    challengeWinReward: number
    exileReward: number
    weeklyParticipationReward: number
  }
  tokenSpendingRules: {
    buyClue: number | null
    buyVoteSteal: number | null
    buyWaiverPriorityBoost: number | null
    buyProtection: number | null
  }
  tokenShopStatus: LedgerStatus
  tokenLedgerStatus: LedgerStatus
}

export interface SurvivorStructure {
  castSize: number
  tribeSettings: SurvivorTribeSettings
  challengeSettings: SurvivorChallengeSettings
  votingSettings: SurvivorVotingSettings
  exileSettings: SurvivorExileSettings
  idolSettings: SurvivorIdolSettings
  tokenSettings: SurvivorTokenSettings
}

export interface SurvivorRosterTemplate {
  rosterMode: 'survivor'
  starterSlots: Record<string, number>
  flexDefinitions: Array<{ slotName: string; allowedPositions: string[] }>
  benchSlots: number
  irSlots: 0
  taxiSlots: 0
  rosterSlots: number
  totalRosterSlots: number
  draftRounds: number
  draftablePlayerPositions: string[]
  defensePosition: 'DST' | 'DEF' | null
}

export interface SurvivorDraftSettings {
  draftType: EngineDraftType
  requestedDraftType: SurvivorDraftType
  rounds: number
  timerSeconds: number
  autopickBehavior: 'queue-first'
  autopickBehaviorAlias: 'queue_first'
  queueSizeLimit: number
  preDraftRankingSource: 'adp' | 'ecr'
  rosterFillOrder: string
  positionFilterBehavior: string
  thirdRoundReversal: false
  auctionBudgetPerTeam: number | null
}

export interface SurvivorDefaultContract {
  sport: SurvivorEligibleSport
  league_type: 'survivor'
  leagueType: 'survivor'
  survivor_enabled: true
  survivor_phase: SurvivorPhase
  draft_type: EngineDraftType
  requested_draft_type: SurvivorDraftType
  teams: number
  rounds: number
  timer_seconds: number
  scoring_preset_id: string
  roster_mode: 'survivor'
  survivorStructure: SurvivorStructure
  rosterTemplate: SurvivorRosterTemplate
  scoringSettings: Record<string, unknown>
  draftSettings: SurvivorDraftSettings
  playerPoolRules: Record<string, unknown>
  waiverSettings: Record<string, unknown>
  tabsEnabled: Record<string, true | 'commissioner' | 'pending'>
  enabledFeatures: Record<string, boolean>
  seasonSettings: Record<string, unknown>
  creationPlan: Record<string, unknown>
}

// ── Roster configs ─────────────────────────────────────────────────────────────
// Survivor uses redraft-style starters (9) with a smaller bench (3) to emphasize
// weekly roster management and keep the cast size at a clean round number.
// NFL: 9 starters + 3 bench = 12 roster spots → 12 rounds draft → cast of 16
// NCAAF: same shape → cast of 14

const NFL_SURVIVOR_STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 } as const
const NCAAF_SURVIVOR_STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 } as const

const NFL_SURVIVOR_ROSTER_CONFIG = {
  starterSlots: NFL_SURVIVOR_STARTERS as Record<string, number>,
  benchSlots: 3,
  rosterSize: 12,
  defensePosition: 'DST' as const,
  draftablePlayerPositions: ['QB', 'RB', 'WR', 'TE', 'K', 'DST'],
  queueSizeLimit: 50,
  scoringPreset: 'fb_half_ppr',
  // NFL: 16 cast = 2 tribes × 8 → merge at 8; 17-week NFL season provides enough rounds
  castSize: 20,
  tribeCount: 4,
  mergeAtCount: 10,
}

const NCAAF_SURVIVOR_ROSTER_CONFIG = {
  starterSlots: NCAAF_SURVIVOR_STARTERS as Record<string, number>,
  benchSlots: 3,
  rosterSize: 12,
  defensePosition: 'DEF' as const,
  draftablePlayerPositions: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'],
  queueSizeLimit: 70,
  scoringPreset: 'ncaaf_half_ppr',
  // NCAAF: 14 cast = 2 tribes × 7 → merge at 7; 14-week NCAAF season is the ceiling
  castSize: 20,
  tribeCount: 4,
  mergeAtCount: 10,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function isSurvivorEligibleSport(sport: unknown): sport is SurvivorEligibleSport {
  const normalized = String(sport ?? '').trim().toUpperCase()
  return normalized === 'NFL' || normalized === 'NCAAF' || isSurvivorDailySport(normalized)
}

function normalizeEngineDraftType(draftType: unknown): EngineDraftType {
  const requested = normalizeSurvivorDraftType(draftType)
  return requested === 'offline' || requested === 'auto' ? 'snake' : requested
}

function normalizeSurvivorDraftType(value: unknown): SurvivorDraftType {
  const raw = String(value ?? '').trim().toLowerCase().replace(/-/g, '_')
  // Retired Phase 1 ids. Neither ever reached the engine as anything but a snake draft.
  if (raw === 'team' || raw === 'by_team' || raw === 'realtime' || raw === 'real_time') return 'snake'
  return (SURVIVOR_DRAFT_TYPE_IDS as readonly string[]).includes(raw)
    ? (raw as SurvivorDraftType)
    : 'snake'
}

function starterCount(slots: Record<string, number>): number {
  return Object.values(slots).reduce((t, n) => t + n, 0)
}

type SurvivorDailySport = 'NBA' | 'NHL' | 'MLB'

function isSurvivorDailySport(sport: string): sport is SurvivorDailySport {
  return sport === 'NBA' || sport === 'NHL' || sport === 'MLB'
}

/**
 * Survivor's own NBA/NHL/MLB roster. It used to read the sport-defaults registry's base roster, which is
 * now the redraft layout (lib/sportConfig/dailySportRedraftRoster.ts); pinned here so moving the
 * redraft default does not silently resize a beta survivor league. These are the values it read.
 */
const SURVIVOR_DAILY_ROSTERS = {
  NBA: {
    starter_slots: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 1 } as Record<string, number>,
    bench_slots: 4,
    flex_definitions: [
      { slotName: 'G', allowedPositions: ['PG', 'SG'] },
      { slotName: 'F', allowedPositions: ['SF', 'PF'] },
      { slotName: 'UTIL', allowedPositions: ['PG', 'SG', 'SF', 'PF', 'C'] },
    ],
  },
  NHL: {
    starter_slots: { C: 2, LW: 2, RW: 2, D: 2, G: 1, UTIL: 1 } as Record<string, number>,
    bench_slots: 6,
    flex_definitions: [{ slotName: 'UTIL', allowedPositions: ['C', 'LW', 'RW', 'D'] }],
  },
  /*
   * MLB pitchers are stored as plain `P`: every active MLB pitcher in `Player`, and every pitcher in
   * `sports_players`, carries `P`, never `SP` or `RP` (measured 2026-10-27). The redraft layout's
   * SP and RP slots take only `SP` / `RP`, so they could never be filled from this pool. Survivor
   * starts four `P` slots instead, which take any pitcher.
   */
  MLB: {
    starter_slots: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 3, UTIL: 1, P: 4 } as Record<string, number>,
    bench_slots: 5,
    flex_definitions: [
      { slotName: 'OF', allowedPositions: ['OF', 'LF', 'CF', 'RF'] },
      { slotName: 'UTIL', allowedPositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'LF', 'CF', 'RF', 'DH'] },
      { slotName: 'P', allowedPositions: ['SP', 'RP', 'P'] },
    ],
  },
} as const

const SURVIVOR_DAILY_DRAFTABLE_POSITIONS: Record<SurvivorDailySport, string[]> = {
  NBA: ['PG', 'SG', 'SF', 'PF', 'C'],
  NHL: ['C', 'LW', 'RW', 'D', 'G'],
  MLB: ['C', '1B', '2B', '3B', 'SS', 'OF', 'LF', 'CF', 'RF', 'DH', 'P', 'SP', 'RP'],
}

function rosterConfig(sport: SurvivorEligibleSport) {
  if (isSurvivorDailySport(sport)) {
    const defaults = SURVIVOR_DAILY_ROSTERS[sport]
    const starterSlots = defaults.starter_slots
    return { starterSlots, benchSlots: defaults.bench_slots, rosterSize: starterCount(starterSlots) + defaults.bench_slots,
      defensePosition: null, draftablePlayerPositions: SURVIVOR_DAILY_DRAFTABLE_POSITIONS[sport],
      queueSizeLimit: 70, scoringPreset: `${sport.toLowerCase()}_points`, castSize: 20, tribeCount: 4, mergeAtCount: 10 }
  }
  return sport === 'NCAAF' ? NCAAF_SURVIVOR_ROSTER_CONFIG : NFL_SURVIVOR_ROSTER_CONFIG
}

// ── Builders ──────────────────────────────────────────────────────────────────

function buildTribeSettings(sport: SurvivorEligibleSport): SurvivorTribeSettings {
  const cfg = rosterConfig(sport)
  return {
    castSize: cfg.castSize,
    tribeCount: cfg.tribeCount,
    tribeAssignmentMode: 'random',
    mergeAtCount: cfg.mergeAtCount,
    commissionerPlays: false,
    rocksEnabled: true,
  }
}

function buildChallengeSettings(): SurvivorChallengeSettings {
  return {
    weeklyChallengeSEnabled: true,
    // Phase 2: challenge finalization engine not yet built
    challengeAutomationStatus: 'pending',
    preMergeChallengeType: 'tribe_score',
    postMergeChallengeType: 'individual_score',
    challengeScoringSource: 'fantasy_points_for',
    immunityEnabled: true,
    immunityWinnerNote:
      'Immunity winner is the highest-scoring tribe (pre-merge) or individual (post-merge) after the scoring period finalizes. Requires challenge finalization engine (Phase 2).',
  }
}

function buildVotingSettings(): SurvivorVotingSettings {
  return {
    tribalCouncilEnabled: true,
    // Phase 2: vote engine not yet built
    votingAutomationStatus: 'pending',
    preMergeVotingMode: 'tribe_vote',
    postMergeVotingMode: 'individual_vote',
    eliminationsPerCycle: 1,
    voteVisibility: 'hidden_until_reveal',
    tieResolution: 'rocks_after_revote',
    commissionerOverrideStatus: 'pending',
  }
}

function buildExileSettings(): SurvivorExileSettings {
  return {
    exileEnabled: SURVIVOR_DEFAULT_FOUNDATION_SETTINGS.exileIslandEnabled,
    // Phase 2: exile selection/effects engine not yet built
    exileAutomationStatus: 'pending',
    // Challenge loser's tribe chooses who to send; safe default avoids ambiguity
    exileSelectionMode: 'voted_out',
    exileDurationPeriods: 1,
    exileEffects: {
      cannotVote: true,
      stillScoresFantasyPoints: true,
      receivesClueOrToken: true,
    },
  }
}

function buildIdolSettings(): SurvivorIdolSettings {
  return {
    idolsEnabled: true,
    idolCount:
      SURVIVOR_DEFAULT_FOUNDATION_SETTINGS.defaultTeamCount +
      SURVIVOR_DEFAULT_FOUNDATION_SETTINGS.tribeCount,
    idolPlayWindow: 'before_vote_reveal',
    idolEffect: 'cancels_votes_against_target',
    // Phase 2: idol search / clue engine and inventory not yet built
    idolSearchAutomationStatus: 'pending',
    idolInventoryStatus: 'not_started',
  }
}

function buildTokenSettings(): SurvivorTokenSettings {
  return {
    tokensEnabled: true,
    // Starting at 0 keeps the economy balanced; commissioner can seed tokens
    startingTokenBalance: 0,
    tokenEarningRules: {
      challengeWinReward: 1,
      exileReward: 1,
      weeklyParticipationReward: 0,
    },
    tokenSpendingRules: {
      buyClue: 2,
      buyVoteSteal: null,     // Phase 2 advantage
      buyWaiverPriorityBoost: null, // Phase 2
      buyProtection: null,    // Phase 2
    },
    // Phase 2: token shop / advantage purchases not yet built
    tokenShopStatus: 'pending',
    tokenLedgerStatus: 'not_started',
  }
}

function buildSurvivorStructure(sport: SurvivorEligibleSport): SurvivorStructure {
  const cfg = rosterConfig(sport)
  return {
    castSize: cfg.castSize,
    tribeSettings: buildTribeSettings(sport),
    challengeSettings: buildChallengeSettings(),
    votingSettings: buildVotingSettings(),
    exileSettings: buildExileSettings(),
    idolSettings: buildIdolSettings(),
    tokenSettings: buildTokenSettings(),
  }
}

function buildRosterTemplate(sport: SurvivorEligibleSport): SurvivorRosterTemplate {
  const cfg = rosterConfig(sport)
  const starters = starterCount(cfg.starterSlots)
  return {
    rosterMode: 'survivor',
    starterSlots: cfg.starterSlots,
    flexDefinitions: isSurvivorDailySport(sport) ? SURVIVOR_DAILY_ROSTERS[sport].flex_definitions.map((f) => ({ slotName: f.slotName, allowedPositions: [...f.allowedPositions] })) : [{ slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'] }],
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
  sport: SurvivorEligibleSport,
  scoringPresetId: string,
): Record<string, unknown> {
  if (isSurvivorDailySport(sport)) {
    const defaults = getScoringDefaults(sport)
    return { source: 'af', sport, preset: scoringPresetId, scoringPresetId, scoringTemplateId: defaults.scoring_template_id,
      scoringMode: 'points', scoringFormat: defaults.scoring_format, format: defaults.scoring_format, survivor: true }
  }
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
    survivor: true,
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
  sport: SurvivorEligibleSport,
  draftType: SurvivorDraftType,
  rosterTemplate: SurvivorRosterTemplate,
): SurvivorDraftSettings {
  const cfg = rosterConfig(sport)
  const engineDraftType = normalizeEngineDraftType(draftType)
  return {
    draftType: engineDraftType,
    requestedDraftType: draftType,
    rounds: rosterTemplate.draftRounds,
    timerSeconds: 90,
    autopickBehavior: 'queue-first',
    autopickBehaviorAlias: 'queue_first',
    queueSizeLimit: cfg.queueSizeLimit,
    preDraftRankingSource: sport === 'NCAAF' ? 'ecr' : 'adp',
    rosterFillOrder: 'starter_first',
    positionFilterBehavior: 'by_eligibility',
    thirdRoundReversal: false,
    auctionBudgetPerTeam: engineDraftType === 'auction' ? 200 : null,
  }
}

function buildPlayerPoolRules(
  sport: SurvivorEligibleSport,
  rosterTemplate: SurvivorRosterTemplate,
): Record<string, unknown> {
  const positions = rosterTemplate.draftablePlayerPositions
  if (isSurvivorDailySport(sport)) return { sport, poolKey: sport.toLowerCase() + '_active_fantasy_players', source: 'sports_player',
    includeActiveOnly: true, includeCollegePlayers: false, includeNflPlayers: false, collegeOnly: false, rookieOnly: false, positions, rankingSource: 'adp' }
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
      rankingSource: 'ecr',
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

function buildWaiverSettings(): Record<string, unknown> {
  return {
    waiverEnabled: true,
    waiverType: 'faab',
    waiverBudget: 100,
    waiverDays: [3],   // Wednesday processing
    samePeriodPickups: false,
    tradesEnabled: false,
    tradeDeadlineWeek: null,
    tradeReviewMode: 'none',
  }
}

function buildSeasonSettings(sport: SurvivorEligibleSport): Record<string, unknown> {
  const cfg = rosterConfig(sport)
  return {
    scoringPeriod: 'weekly',
    hasPlayoffs: false,
    playoffTeams: 0,
    matchupFormat: 'survivor',
    tradesEnabled: false,
    tradeDeadlineWeek: null,
    tradeReviewMode: 'none',
    waiverEnabled: true,
    survivorCastSize: cfg.castSize,
  }
}

function buildTabsEnabled(): Record<string, true | 'commissioner' | 'pending'> {
  return {
    overview: true,
    survivor_hub: true,
    cast: true,
    tribes: true,
    roster: true,
    standings: true,
    weekly_challenges: true,
    immunity: true,
    tribal_council: true,
    exile_island: 'pending',     // Phase 2 automation pending
    idols_advantages: 'pending', // Phase 2 automation pending
    tokens_shop: 'pending',      // Phase 2 token ledger pending
    draft: true,
    mock_draft: true,
    waivers: true,
    settings: 'commissioner',
    commissioner_tools: 'commissioner',
    invite_share: true,
  }
}

function buildEnabledFeatures(): Record<string, boolean> {
  return {
    survivor_enabled: true,
    survivor_hub: true,
    tribes_enabled: true,
    weekly_challenges_enabled: true,
    immunity_enabled: true,
    tribal_council_enabled: true,
    vote_elimination_enabled: true,
    rocks_enabled: true,
    exile_enabled: SURVIVOR_DEFAULT_FOUNDATION_SETTINGS.exileIslandEnabled,
    idols_enabled: true,
    tokens_enabled: true,
    // Phase 2 automation flags — all pending, never fake-true
    challenge_automation: false,
    voting_automation: false,
    exile_automation: false,
    idol_search_automation: false,
    token_ledger_active: false,
    token_shop_active: false,
    merge_automation: false,
    // Standard flags
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
    salary_cap: false,
    salary_cap_enabled: false,
    isSurvivor: true,
    isDynasty: false,
    isRedraft: false,
    isKeeper: false,
    isBestBall: false,
    isGuillotine: false,
    isTournament: false,
  }
}

function buildCreationPlan(
  sport: SurvivorEligibleSport,
  structure: SurvivorStructure,
): Record<string, unknown> {
  return {
    phase: 'setup' as SurvivorPhase,
    castSize: structure.castSize,
    tribeCount: structure.tribeSettings.tribeCount,
    mergeAtCount: structure.tribeSettings.mergeAtCount,
    commissionerPlays: structure.tribeSettings.commissionerPlays,
    // Phase 1: all automation subsystems are declared but not yet active
    challengeAutomationStatus: 'pending',
    votingAutomationStatus: 'pending',
    exileAutomationStatus: 'pending',
    idolSearchAutomationStatus: 'pending',
    tokenLedgerStatus: 'not_started',
    tokenShopStatus: 'pending',
    tribeAssignmentStatus: 'not_started',
    note: 'Survivor game automation is Phase 2. Use commissioner tools to manage challenges, votes, exile, idols, and tokens.',
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getSurvivorDefaultContract(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): SurvivorDefaultContract | null {
  const normalizedSport = String(input.sport ?? '').trim().toUpperCase()
  if (!isSurvivorEligibleSport(normalizedSport)) return null

  const sport = normalizedSport
  const cfg = rosterConfig(sport)
  const teamCount =
    typeof input.teamCount === 'number' && input.teamCount > 0
      ? Math.floor(input.teamCount)
      : cfg.castSize
  const requestedDraftType = normalizeSurvivorDraftType(input.draftType)
  const survivorStructure = buildSurvivorStructure(sport)
  survivorStructure.castSize = teamCount
  survivorStructure.tribeSettings.castSize = teamCount
  survivorStructure.tribeSettings.mergeAtCount = Math.min(
    survivorStructure.tribeSettings.mergeAtCount,
    Math.ceil(teamCount / 2),
  )
  const rosterTemplate = buildRosterTemplate(sport)
  const draftSettings = buildDraftSettings(sport, requestedDraftType, rosterTemplate)
  const scoringPresetId =
    typeof input.scoringPresetId === 'string' && input.scoringPresetId.trim()
      ? input.scoringPresetId.trim()
      : cfg.scoringPreset
  const scoringSettings = buildScoringSettings(sport, scoringPresetId)
  const playerPoolRules = buildPlayerPoolRules(sport, rosterTemplate)
  const waiverSettings = buildWaiverSettings()
  const seasonSettings = buildSeasonSettings(sport)
  const tabsEnabled = buildTabsEnabled()
  const enabledFeatures = buildEnabledFeatures()
  const creationPlan = buildCreationPlan(sport, survivorStructure)
  return {
    sport,
    league_type: 'survivor',
    leagueType: 'survivor',
    survivor_enabled: true,
    survivor_phase: 'setup',
    draft_type: draftSettings.draftType,
    requested_draft_type: requestedDraftType,
    teams: teamCount,
    rounds: draftSettings.rounds,
    timer_seconds: draftSettings.timerSeconds,
    scoring_preset_id: scoringPresetId,
    roster_mode: 'survivor',
    survivorStructure,
    rosterTemplate,
    scoringSettings,
    draftSettings,
    playerPoolRules,
    waiverSettings,
    tabsEnabled,
    enabledFeatures,
    seasonSettings,
    creationPlan,
  }
}

export function buildSurvivorSettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
}): Record<string, unknown> | null {
  const contract = getSurvivorDefaultContract(input)
  if (!contract) return null

  const { draftSettings, rosterTemplate, survivorStructure } = contract
  const { tribeSettings, challengeSettings, votingSettings, exileSettings, idolSettings, tokenSettings } = survivorStructure

  return {
    survivorDefaultsVersion: 1,
    // New leagues use the score boss; existing leagues were backfilled to the Chimmy roster boss.
    exileBossMode: NEW_LEAGUE_EXILE_BOSS_MODE,
    sport: contract.sport,
    sport_type: contract.sport,
    leagueType: 'survivor',
    league_type: 'survivor',
    roster_mode: 'survivor',
    survivor_enabled: true,
    survivor_phase: contract.survivor_phase,
    isSurvivor: true,
    teams: contract.teams,
    default_team_count: contract.teams,
    cast_size: survivorStructure.castSize,
    scoring_preset_id: contract.scoring_preset_id,
    scoringPreset: contract.scoring_preset_id,
    scoring_mode: 'points',
    scoring_format: contract.scoringSettings.scoringFormat,
    scoring_template_id: contract.scoringSettings.scoringTemplateId,

    // Draft fields
    draft_type: draftSettings.draftType,
    requested_draft_type: draftSettings.requestedDraftType,
    draft_rounds: draftSettings.rounds,
    draft_timer_seconds: draftSettings.timerSeconds,
    draft_autopick_behavior: draftSettings.autopickBehavior,
    draft_autopick_behavior_alias: draftSettings.autopickBehaviorAlias,
    draft_queue_size_limit: draftSettings.queueSizeLimit,
    queue_size_limit: draftSettings.queueSizeLimit,
    draft_pre_draft_ranking_source: draftSettings.preDraftRankingSource,
    draft_roster_fill_order: draftSettings.rosterFillOrder,
    draft_position_filter_behavior: draftSettings.positionFilterBehavior,
    draft_order: draftSettings.draftType === 'auction' ? 'auction' : 'snake',
    // How the draft runs (DraftUISettingsResolver.executionMode): the room, the computer, or in person.
    draft_execution_mode: draftSettings.requestedDraftType === 'offline' ? 'offline' : draftSettings.requestedDraftType === 'auto' ? 'auto' : 'live',
    // Survivor drafts talk: the room shares the league chat stream while the draft runs.
    draft_live_chat_sync_enabled: true,
    third_round_reversal: false,
    rounds: draftSettings.rounds,
    timer_seconds: draftSettings.timerSeconds,

    // Roster fields
    roster_size: rosterTemplate.totalRosterSlots,
    rosterSize: rosterTemplate.totalRosterSlots,
    starter_slots: rosterTemplate.starterSlots,
    bench_slots: rosterTemplate.benchSlots,
    ir_slots: 0,
    taxi_slots: 0,
    rosterTemplate,
    rosterSettings: {
      rosterMode: 'survivor',
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

    // Scoring / settings
    scoringSettings: contract.scoringSettings,
    draftSettings,
    waiverSettings: contract.waiverSettings,
    seasonSettings: contract.seasonSettings,

    // Survivor structure (all sub-systems)
    survivorStructure,
    survivor_structure: survivorStructure,

    // Tribe / merge
    tribe_count: tribeSettings.tribeCount,
    tribe_assignment_mode: tribeSettings.tribeAssignmentMode,
    merge_at_count: tribeSettings.mergeAtCount,
    commissioner_plays: tribeSettings.commissionerPlays,
    rocks_enabled: tribeSettings.rocksEnabled,

    // Challenges
    weekly_challenges_enabled: challengeSettings.weeklyChallengeSEnabled,
    challenge_automation_status: challengeSettings.challengeAutomationStatus,
    pre_merge_challenge_type: challengeSettings.preMergeChallengeType,
    post_merge_challenge_type: challengeSettings.postMergeChallengeType,
    challenge_scoring_source: challengeSettings.challengeScoringSource,
    immunity_enabled: challengeSettings.immunityEnabled,

    // Voting
    tribal_council_enabled: votingSettings.tribalCouncilEnabled,
    voting_automation_status: votingSettings.votingAutomationStatus,
    pre_merge_voting_mode: votingSettings.preMergeVotingMode,
    post_merge_voting_mode: votingSettings.postMergeVotingMode,
    eliminations_per_cycle: votingSettings.eliminationsPerCycle,
    vote_visibility: votingSettings.voteVisibility,
    tie_resolution: votingSettings.tieResolution,
    vote_elimination_enabled: true,

    // Exile
    exile_enabled: exileSettings.exileEnabled,
    exile_automation_status: exileSettings.exileAutomationStatus,
    exile_selection_mode: exileSettings.exileSelectionMode,
    exile_duration_periods: exileSettings.exileDurationPeriods,
    exile_effects: exileSettings.exileEffects,

    // Idols
    idols_enabled: idolSettings.idolsEnabled,
    idol_count: idolSettings.idolCount,
    idol_play_window: idolSettings.idolPlayWindow,
    idol_effect: idolSettings.idolEffect,
    idol_search_automation_status: idolSettings.idolSearchAutomationStatus,
    idol_inventory_status: idolSettings.idolInventoryStatus,

    // Tokens
    tokens_enabled: tokenSettings.tokensEnabled,
    starting_token_balance: tokenSettings.startingTokenBalance,
    token_earning_rules: tokenSettings.tokenEarningRules,
    token_spending_rules: tokenSettings.tokenSpendingRules,
    token_shop_status: tokenSettings.tokenShopStatus,
    token_ledger_status: tokenSettings.tokenLedgerStatus,

    // Pool
    playerPoolRules: contract.playerPoolRules,
    player_pool_rules: contract.playerPoolRules,
    player_pool: contract.playerPoolRules.poolKey,

    // UI
    tabsEnabled: contract.tabsEnabled,
    tabs_enabled: contract.tabsEnabled,
    creationPlan: contract.creationPlan,
    creation_plan: contract.creationPlan,

    ...contract.enabledFeatures,
    ...buildSurvivorSettingsSnapshotPatch({
      // Council rules by sport: ceremony day/time after final scores, revote-then-rocks, ballots
      // changeable until close, missing ballots auto-cast (owner's call, 2026-10-20).
      ...survivorCouncilDefaultsForSport(contract.sport),
      defaultTeamCount: contract.teams,
      tribeCount: tribeSettings.tribeCount,
      mergeActivePlayerCount: tribeSettings.mergeAtCount,
      tribeAssignmentMode: tribeSettings.tribeAssignmentMode,
      commissionerParticipationMode: 'non_participating_host',
      idolsEnabled: idolSettings.idolsEnabled,
      exileIslandEnabled: exileSettings.exileEnabled,
    }),

    // Hard guardrails
    devyConfig: { enabled: false },
    c2cConfig: { enabled: false },
    keeperSettings: { enabled: false },
    salaryCapSettings: { enabled: false },
    contractSettings: { enabled: false },
    rookieDraftConfig: { enabled: false },
    futurePicksConfig: { enabled: false },
  }
}

export function normalizeSurvivorSettingsSnapshot(input: {
  sport: LeagueSport | string
  draftType?: unknown
  scoringPresetId?: string | null
  teamCount?: number | null
  settings?: Record<string, unknown> | null
}): Record<string, unknown> {
  const incoming = input.settings ?? {}
  const requestedDraftType = normalizeSurvivorDraftType(
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
    buildSurvivorSettingsSnapshot({
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
  merged.rounds = defaults.rounds

  // Enforce survivor invariants
  merged.league_type = 'survivor'
  merged.leagueType = 'survivor'
  merged.roster_mode = 'survivor'
  merged.survivor_enabled = true
  merged.isSurvivor = true
  merged.isDynasty = false
  merged.isRedraft = false
  merged.isKeeper = false
  merged.isBestBall = false
  merged.isGuillotine = false
  merged.isTournament = false

  // Hard guardrails — these must never be set in survivor
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

  // Phase 1: automation must never be claimed active unless real engine exists
  merged.challenge_automation_status = incoming.challenge_automation_status === 'active' ? 'pending' : (incoming.challenge_automation_status ?? 'pending')
  merged.voting_automation_status = incoming.voting_automation_status === 'active' ? 'pending' : (incoming.voting_automation_status ?? 'pending')
  merged.exile_automation_status = incoming.exile_automation_status === 'active' ? 'pending' : (incoming.exile_automation_status ?? 'pending')
  merged.idol_search_automation_status = incoming.idol_search_automation_status === 'active' ? 'pending' : (incoming.idol_search_automation_status ?? 'pending')
  merged.token_ledger_status = incoming.token_ledger_status === 'active' ? 'pending' : (incoming.token_ledger_status ?? 'not_started')

  // Mock drafts must not trigger game events
  if (merged.draft_type === 'mock_draft' || merged.mock_draft_mode === true) {
    merged.survivor_game_events_from_mock = false
    merged.mock_triggers_challenges = false
    merged.mock_triggers_immunity = false
    merged.mock_triggers_votes = false
    merged.mock_triggers_exile = false
    merged.mock_triggers_idols = false
    merged.mock_triggers_tokens = false
  }

  // Preserve user-supplied league name / language / timezone
  if (typeof incoming.leagueName === 'string') merged.leagueName = incoming.leagueName
  if (typeof incoming.language === 'string') merged.language = incoming.language
  if (typeof incoming.timezone === 'string') merged.timezone = incoming.timezone

  return merged
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface SurvivorValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validateSurvivorStructure(input: {
  castSize: number
  tribeCount: number
  mergeAtCount: number
  commissionerPlays?: boolean
}): SurvivorValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const { castSize, tribeCount, mergeAtCount } = input

  if (castSize < 4) {
    errors.push(`castSize (${castSize}) must be at least 4.`)
  }
  if (tribeCount < 2) {
    errors.push(`tribeCount (${tribeCount}) must be at least 2.`)
  }
  if (castSize % tribeCount !== 0) {
    warnings.push(
      `castSize (${castSize}) is not evenly divisible by tribeCount (${tribeCount}). Tribes will be uneven.`,
    )
  }
  if (mergeAtCount >= castSize) {
    errors.push(`mergeAtCount (${mergeAtCount}) must be less than castSize (${castSize}).`)
  }
  if (mergeAtCount < 2) {
    errors.push(`mergeAtCount (${mergeAtCount}) must be at least 2.`)
  }
  const teamsPerTribe = Math.floor(castSize / tribeCount)
  if (teamsPerTribe < 2) {
    errors.push(`teamsPerTribe (${teamsPerTribe}) must be at least 2 for challenges to work.`)
  }

  return { valid: errors.length === 0, errors, warnings }
}
