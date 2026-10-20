import { readTribeSlots, type SurvivorTribeSlot } from './survivorTribeIdentity'
export type SurvivorTribeAssignmentMode = 'random' | 'commissioner_manual' | 'draft_pattern'
export type SurvivorCommissionerParticipationMode = 'non_participating_host' | 'participating_player'
export type SurvivorCoCommissionerMode = 'disabled' | 'non_participating_host' | 'same_privacy_as_commissioner'
export type SurvivorMergeTriggerType = 'week' | 'active_player_count'
export type SurvivorVoteChangePolicy = 'first_valid_locks' | 'allow_until_close'
/**
 * How a tied council resolves (owner's call, 2026-10-20): revote, then rocks — a seeded draw among
 * the still-tied managers — or rocks straight away. The two season-points rules remain readable for
 * leagues created before this.
 */
export type SurvivorTieRule = 'revote_then_rocks' | 'rocks_immediately' | 'revote_then_season_points' | 'season_points_only'
export const SURVIVOR_TIE_RULES = ['revote_then_rocks', 'rocks_immediately', 'revote_then_season_points', 'season_points_only'] as const
export type SurvivorEliminationOutcome = 'removed_to_waivers' | 'exile_island'
export type SurvivorScreenshotsPolicy = 'host_dm_private' | 'allowed_except_host_ai_dms'
export type SurvivorConductPolicy = 'game_deception_allowed_platform_abuse_banned'
export type SurvivorNbaWeeklyScoringMode = 'all_games' | 'one_game_per_player'

export interface SurvivorFoundationSettings {
  tribeCount: number
  survivorTribeSlots: SurvivorTribeSlot[]
  defaultTeamCount: number
  minTeamCount: number
  maxTeamCount: number
  tribeAssignmentMode: SurvivorTribeAssignmentMode
  commissionerParticipationMode: SurvivorCommissionerParticipationMode
  hideIdolsFromCommissioner: boolean
  coCommissionerMode: SurvivorCoCommissionerMode
  mergeTriggerType: SurvivorMergeTriggerType
  mergeWeek: number
  mergeActivePlayerCount: number
  juryThresholdPercent: number
  tribalCouncilDay: string
  tribalCouncilTime: string
  voteOpenOffset: number
  voteCloseOffset: number
  lateVotesAllowed: boolean
  selfVotesAllowed: boolean
  voteChangePolicy: SurvivorVoteChangePolicy
  tieRule: SurvivorTieRule
  /** A missing ballot is cast for the voter's lowest-scoring eligible target that week. */
  nonVoterAutoCast: boolean
  autoReveal: boolean
  eliminationOutcome: SurvivorEliminationOutcome
  sitOutsEnabled: boolean
  noConsecutiveSitOuts: boolean
  nbaWeeklyScoringMode: SurvivorNbaWeeklyScoringMode
  idolExpiryRemainingPlayers: number
  idolInvalidRemainingPlayers: number
  idolCount: number
  idolsEnabled: boolean
  powerupsEnabled: boolean
  tribeChatsEnabled: boolean
  privateDMVotesEnabled: boolean
  exileIslandEnabled: boolean
  exileReturnWeek: number
  exileReturnTokens: number
  juryEnabled: boolean
  finaleVotingEnabled: boolean
  survivorIntroVideoEnabled: boolean
  survivorDraftVideoEnabled: boolean
  screenshotsPolicy: SurvivorScreenshotsPolicy
  conductPolicy: SurvivorConductPolicy
  /** Share cards (images + public moment pages). A private league can turn them off. */
  shareCardsEnabled: boolean
  /**
   * Public moment pages (survivor-core, Sharing). Off: a shared link shows the private-league page
   * instead of the moment. Share cards still work inside the league.
   */
  publicMomentPages: boolean
}

type SettingsRecord = Record<string, unknown>

export const SURVIVOR_FOUNDATION_SETTINGS_VERSION = 1

export const SURVIVOR_TEAM_COUNT_OPTIONS = [16, 17, 18, 19, 20] as const
export const SURVIVOR_CANONICAL_DRAFT_TYPE_IDS = [
  'snake',
  'auction',
  'linear',
  'real_time',
  'by_team',
  'offline',
  'auto',
] as const

export const SURVIVOR_DEFAULT_FOUNDATION_SETTINGS: SurvivorFoundationSettings = {
  tribeCount: 4,
  survivorTribeSlots: readTribeSlots({}, 20, 4),
  defaultTeamCount: 20,
  minTeamCount: 16,
  maxTeamCount: 20,
  tribeAssignmentMode: 'random',
  commissionerParticipationMode: 'non_participating_host',
  hideIdolsFromCommissioner: false,
  coCommissionerMode: 'disabled',
  mergeTriggerType: 'active_player_count',
  mergeWeek: 7,
  mergeActivePlayerCount: 10,
  juryThresholdPercent: 60,
  tribalCouncilDay: 'Tuesday',
  tribalCouncilTime: '20:00',
  voteOpenOffset: 0,
  voteCloseOffset: 24,
  lateVotesAllowed: false,
  selfVotesAllowed: false,
  voteChangePolicy: 'allow_until_close',
  tieRule: 'revote_then_rocks',
  nonVoterAutoCast: true,
  autoReveal: true,
  eliminationOutcome: 'removed_to_waivers',
  sitOutsEnabled: true,
  noConsecutiveSitOuts: true,
  nbaWeeklyScoringMode: 'all_games',
  idolExpiryRemainingPlayers: 5,
  idolInvalidRemainingPlayers: 4,
  idolCount: 7,
  idolsEnabled: true,
  powerupsEnabled: true,
  tribeChatsEnabled: true,
  privateDMVotesEnabled: true,
  exileIslandEnabled: true,
  exileReturnWeek: 10,
  exileReturnTokens: 4,
  juryEnabled: true,
  finaleVotingEnabled: true,
  survivorIntroVideoEnabled: true,
  survivorDraftVideoEnabled: true,
  screenshotsPolicy: 'host_dm_private',
  conductPolicy: 'game_deception_allowed_platform_abuse_banned',
  shareCardsEnabled: true,
  publicMomentPages: true,
}

function readNumber(input: SettingsRecord, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value)
      if (Number.isFinite(n)) return n
    }
  }
  return fallback
}

function readBoolean(input: SettingsRecord, keys: string[], fallback: boolean): boolean {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (normalized === 'true') return true
      if (normalized === 'false') return false
    }
  }
  return fallback
}

function readString(input: SettingsRecord, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return fallback
}

function clampInt(value: number, min: number, max: number): number {
  const n = Number.isFinite(value) ? Math.round(value) : min
  return Math.min(max, Math.max(min, n))
}

function normalizeTribeAssignment(value: string): SurvivorTribeAssignmentMode {
  const raw = value.trim().toLowerCase()
  if (raw === 'manual' || raw === 'commissioner' || raw === 'commissioner_manual') return 'commissioner_manual'
  if (raw === 'schoolyard' || raw === 'snake_draft' || raw === 'draft_pattern' || raw === 'draft-pattern') return 'draft_pattern'
  return 'random'
}

function normalizeCommissionerMode(value: string, participantHint: boolean): SurvivorCommissionerParticipationMode {
  const raw = value.trim().toLowerCase()
  if (participantHint || raw === 'participating_player' || raw === 'player_commissioner') return 'participating_player'
  return 'non_participating_host'
}

function normalizeCoCommissionerMode(value: string): SurvivorCoCommissionerMode {
  const raw = value.trim().toLowerCase()
  if (raw === 'non_participating_host') return 'non_participating_host'
  if (raw === 'same_privacy_as_commissioner' || raw === 'enabled') return 'same_privacy_as_commissioner'
  return 'disabled'
}

function normalizeMergeTrigger(value: string): SurvivorMergeTriggerType {
  const raw = value.trim().toLowerCase()
  if (raw === 'players_remaining' || raw === 'player_count' || raw === 'active_player_count') return 'active_player_count'
  return 'week'
}

function normalizeTieRule(value: string): SurvivorTieRule {
  return (SURVIVOR_TIE_RULES as readonly string[]).includes(value) ? value as SurvivorTieRule : 'revote_then_rocks'
}

function normalizeVoteChangePolicy(value: string): SurvivorVoteChangePolicy {
  const raw = value.trim().toLowerCase()
  if (raw === 'allow_until_close' || raw === 'unlocked_until_close') return 'allow_until_close'
  return 'first_valid_locks'
}

function normalizeEliminationOutcome(value: string): SurvivorEliminationOutcome {
  const raw = value.trim().toLowerCase()
  if (raw === 'exile' || raw === 'exile_island') return 'exile_island'
  return 'removed_to_waivers'
}

export function normalizeSurvivorFoundationSettings(
  input: SettingsRecord | null | undefined,
): SurvivorFoundationSettings {
  const raw = input ?? {}
  const nested =
    raw.survivorFoundationSettings &&
    typeof raw.survivorFoundationSettings === 'object' &&
    !Array.isArray(raw.survivorFoundationSettings)
      ? (raw.survivorFoundationSettings as SettingsRecord)
      : {}
  const s = { ...nested, ...raw }
  const base = SURVIVOR_DEFAULT_FOUNDATION_SETTINGS
  const minTeamCount = clampInt(readNumber(s, ['minTeamCount', 'survivor_min_team_count'], base.minTeamCount), 16, 20)
  const maxTeamCount = clampInt(readNumber(s, ['maxTeamCount', 'survivor_max_team_count'], base.maxTeamCount), minTeamCount, 20)
  const defaultTeamCount = clampInt(
    readNumber(s, ['defaultTeamCount', 'default_team_count', 'teams', 'survivorPlayerCount', 'cast_size'], base.defaultTeamCount),
    minTeamCount,
    maxTeamCount,
  )
  const tribeCount = clampInt(
    readNumber(s, ['tribeCount', 'tribe_count', 'survivorTribeCount', 'survivor_suggested_tribe_count'], base.tribeCount),
    2,
    5,
  )
  const commissionerHint = readBoolean(
    s,
    ['survivorCommissionerPlays', 'commissionerParticipates', 'survivor_commissioner_participates'],
    false,
  )
  const mergeActivePlayerCount = clampInt(
    readNumber(s, ['mergeActivePlayerCount', 'merge_at_count', 'survivorMergeAtCount'], Math.ceil(defaultTeamCount / 2)),
    4,
    defaultTeamCount,
  )

  return {
    tribeCount,
    survivorTribeSlots: readTribeSlots(s, defaultTeamCount, tribeCount),
    defaultTeamCount,
    minTeamCount,
    maxTeamCount,
    tribeAssignmentMode: normalizeTribeAssignment(
      readString(s, ['tribeAssignmentMode', 'tribe_assignment_mode', 'survivorTribeFormation'], base.tribeAssignmentMode),
    ),
    commissionerParticipationMode: normalizeCommissionerMode(
      readString(
        s,
        ['commissionerParticipationMode', 'survivor_commissioner_role', 'survivorCommissionerParticipationMode'],
        base.commissionerParticipationMode,
      ),
      commissionerHint,
    ),
    hideIdolsFromCommissioner: readBoolean(s, ['hideIdolsFromCommissioner'], base.hideIdolsFromCommissioner),
    coCommissionerMode: normalizeCoCommissionerMode(readString(s, ['coCommissionerMode'], base.coCommissionerMode)),
    mergeTriggerType: normalizeMergeTrigger(
      readString(s, ['mergeTriggerType', 'merge_trigger_type', 'survivorMergeTrigger'], base.mergeTriggerType),
    ),
    mergeWeek: clampInt(readNumber(s, ['mergeWeek', 'survivorMergeWeek'], base.mergeWeek), 1, 52),
    mergeActivePlayerCount,
    juryThresholdPercent: clampInt(readNumber(s, ['juryThresholdPercent'], base.juryThresholdPercent), 1, 100),
    tribalCouncilDay: readString(s, ['tribalCouncilDay'], base.tribalCouncilDay),
    tribalCouncilTime: readString(s, ['tribalCouncilTime'], base.tribalCouncilTime),
    voteOpenOffset: clampInt(readNumber(s, ['voteOpenOffset'], base.voteOpenOffset), 0, 168),
    voteCloseOffset: clampInt(readNumber(s, ['voteCloseOffset'], base.voteCloseOffset), 1, 168),
    lateVotesAllowed: readBoolean(s, ['lateVotesAllowed'], base.lateVotesAllowed),
    selfVotesAllowed: readBoolean(s, ['selfVotesAllowed', 'survivorSelfVoteAllowed'], base.selfVotesAllowed),
    voteChangePolicy: normalizeVoteChangePolicy(readString(s, ['voteChangePolicy'], base.voteChangePolicy)),
    tieRule: normalizeTieRule(readString(s, ['tieRule'], base.tieRule)),
    nonVoterAutoCast: readBoolean(s, ['nonVoterAutoCast'], base.nonVoterAutoCast),
    autoReveal: readBoolean(s, ['autoReveal'], base.autoReveal),
    eliminationOutcome: normalizeEliminationOutcome(readString(s, ['eliminationOutcome'], readBoolean(s, ['exileIslandEnabled', 'exile_enabled', 'survivorExileEnabled'], base.exileIslandEnabled) ? 'exile_island' : 'removed_to_waivers')),
    sitOutsEnabled: readBoolean(s, ['sitOutsEnabled'], base.sitOutsEnabled),
    noConsecutiveSitOuts: readBoolean(s, ['noConsecutiveSitOuts'], base.noConsecutiveSitOuts),
    nbaWeeklyScoringMode: readString(s, ['nbaWeeklyScoringMode'], base.nbaWeeklyScoringMode) === 'one_game_per_player' ? 'one_game_per_player' : 'all_games',
    idolExpiryRemainingPlayers: clampInt(
      readNumber(s, ['idolExpiryRemainingPlayers'], base.idolExpiryRemainingPlayers),
      2,
      defaultTeamCount,
    ),
    idolInvalidRemainingPlayers: clampInt(
      readNumber(s, ['idolInvalidRemainingPlayers'], base.idolInvalidRemainingPlayers),
      1,
      defaultTeamCount,
    ),
    idolCount: clampInt(readNumber(s, ['idolCount', 'survivorIdolCount'], Math.ceil(defaultTeamCount / 3)), 1, 40),
    idolsEnabled: readBoolean(s, ['idolsEnabled', 'survivorIdolsEnabled'], base.idolsEnabled),
    powerupsEnabled: readBoolean(s, ['powerupsEnabled'], base.powerupsEnabled),
    tribeChatsEnabled: readBoolean(s, ['tribeChatsEnabled'], base.tribeChatsEnabled),
    privateDMVotesEnabled: readBoolean(s, ['privateDMVotesEnabled'], base.privateDMVotesEnabled),
    exileIslandEnabled: readBoolean(s, ['exileIslandEnabled', 'exile_enabled', 'survivorExileEnabled'], base.exileIslandEnabled),
    exileReturnWeek: clampInt(readNumber(s, ['exileReturnWeek', 'survivorExileReturnWeek'], base.exileReturnWeek), 2, 51),
    exileReturnTokens: clampInt(readNumber(s, ['exileReturnTokens'], base.exileReturnTokens), 1, 1000),
    juryEnabled: readBoolean(s, ['juryEnabled'], base.juryEnabled),
    finaleVotingEnabled: readBoolean(s, ['finaleVotingEnabled'], base.finaleVotingEnabled),
    survivorIntroVideoEnabled: readBoolean(s, ['survivorIntroVideoEnabled'], base.survivorIntroVideoEnabled),
    survivorDraftVideoEnabled: readBoolean(s, ['survivorDraftVideoEnabled'], base.survivorDraftVideoEnabled),
    screenshotsPolicy: readString(s, ['screenshotsPolicy'], base.screenshotsPolicy) as SurvivorScreenshotsPolicy,
    conductPolicy: readString(s, ['conductPolicy'], base.conductPolicy) as SurvivorConductPolicy,
    shareCardsEnabled: readBoolean(s, ['shareCardsEnabled'], base.shareCardsEnabled),
    publicMomentPages: readBoolean(s, ['publicMomentPages'], base.publicMomentPages),
  }
}

export function buildSurvivorSettingsSnapshotPatch(
  input: SettingsRecord | null | undefined,
): SettingsRecord {
  const normalized = normalizeSurvivorFoundationSettings(input)
  return {
    survivorFoundationSettingsVersion: SURVIVOR_FOUNDATION_SETTINGS_VERSION,
    survivorFoundationSettings: normalized,
    defaultTeamCount: normalized.defaultTeamCount,
    tribeCount: normalized.tribeCount,
    commissionerParticipationMode: normalized.commissionerParticipationMode,
    hideIdolsFromCommissioner: normalized.hideIdolsFromCommissioner,
    coCommissionerMode: normalized.coCommissionerMode,
    tribeAssignmentMode: normalized.tribeAssignmentMode,
    mergeTriggerType: normalized.mergeTriggerType,
    default_team_count: normalized.defaultTeamCount,
    teams: normalized.defaultTeamCount,
    cast_size: normalized.defaultTeamCount,
    tribe_count: normalized.tribeCount,
    survivorTribeSlots: normalized.survivorTribeSlots,
    survivorIdolCount: normalized.idolCount,
    nbaWeeklyScoringMode: normalized.nbaWeeklyScoringMode,
    tribe_assignment_mode: normalized.tribeAssignmentMode,
    merge_at_count: normalized.mergeActivePlayerCount,
    jury_threshold_percent: normalized.juryThresholdPercent,
    private_vote_channel: 'chimmy_commissioner_dm',
    survivor_commissioner_role:
      normalized.commissionerParticipationMode === 'participating_player'
        ? 'player_commissioner'
        : 'commissioner_only',
    survivor_commissioner_fair_play_limited_visibility:
      normalized.commissionerParticipationMode === 'participating_player',
    survivor_privacy_lock_enabled: true,
    survivor_no_fake_gameplay_state: true,
  }
}

export function buildSurvivorLeagueColumnPatch(settings: SurvivorFoundationSettings): SettingsRecord {
  return {
    survivorMode: true,
    survivorPlayerCount: settings.defaultTeamCount,
    survivorTribeCount: settings.tribeCount,
    survivorTribeSize: Math.max(1, Math.ceil(settings.defaultTeamCount / settings.tribeCount)),
    survivorMergeTrigger: settings.mergeTriggerType === 'active_player_count' ? 'players_remaining' : 'week',
    survivorMergeWeek: settings.mergeWeek,
    survivorMergeAtCount: settings.mergeActivePlayerCount,
    survivorSelfVoteAllowed: settings.selfVotesAllowed,
    survivorIdolCount: settings.idolCount,
    survivorIdolsEnabled: settings.idolsEnabled,
    survivorExileEnabled: settings.exileIslandEnabled,
    survivorExileReturnWeek: settings.exileReturnWeek,
    survivorExileReturnTrigger: settings.exileIslandEnabled ? 'token_leader' : 'manual',
  }
}
