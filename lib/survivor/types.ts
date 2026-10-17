/**
 * Shared types for Survivor league backend engine (PROMPT 346).
 */

import type { LeagueSport } from '@prisma/client'

export type SurvivorMode = 'redraft' | 'bestball'
export type TribeFormation = 'random' | 'commissioner'
export type MergeTrigger = 'week' | 'player_count'
export type SurvivorPhase = 'pre_merge' | 'merge'
export type IdolStatus = 'hidden' | 'revealed' | 'used' | 'expired'

/** Config loaded from DB (SurvivorLeagueConfig + League.sport). */
export interface SurvivorConfig {
  leagueId: string
  configId: string
  mode: SurvivorMode
  tribeCount: number
  tribeSize: number
  tribeFormation: TribeFormation
  mergeTrigger: MergeTrigger
  mergeWeek: number | null
  mergePlayerCount: number | null
  juryStartAfterMerge: number
  exileReturnEnabled: boolean
  exileReturnTokens: number
  idolCount: number
  idolPowerPool: string[] | null
  tribeShuffleEnabled: boolean
  tribeShuffleConsecutiveLosses: number | null
  tribeShuffleImbalanceThreshold: number | null
  voteDeadlineDayOfWeek: number | null
  voteDeadlineTimeUtc: string | null
  selfVoteDisallowed: boolean
  tribalCouncilDayOfWeek: number | null
  tribalCouncilTimeUtc: string | null
  minigameFrequency: string
  /** Commissioner headline — e.g. Heroes vs Villains (not a built-in default). */
  seasonThemeLabel: string | null
  /** Persistent visual theme used by the island and commissioner surfaces. */
  visualThemeId: string | null
  /** Engine-generated weekly challenges from templates when true. */
  challengesSystemRun: boolean
  /** Optional last regular-season week (no playoffs). */
  regularSeasonEndWeek: number | null
  /** Set after FAQ broadcast was posted to league chat. */
  faqSeededAt: string | null
}

export interface SurvivorTribeRow {
  logoUrl?: string | null
  colorHex?: string | null
  id: string
  leagueId: string
  configId: string
  name: string
  slotIndex: number
}

export interface SurvivorTribeMemberRow {
  id: string
  tribeId: string
  rosterId: string
  isLeader: boolean
}

/** Tribe + members for service layer. */
export interface SurvivorTribeWithMembers extends SurvivorTribeRow {
  members: SurvivorTribeMemberRow[]
}

/** Idol power type ids (deterministic registry). */
export type IdolPowerType =
  | 'protect_self'
  | 'protect_self_plus_one'
  | 'steal_player'
  | 'freeze_waivers'
  | 'extra_vote'
  | 'vote_nullifier'
  | 'score_boost'
  | 'tribe_immunity_modifier'
  | 'secret_tribe_power'
  | 'swap_starter'
  | 'force_tribe_shuffle'
  | 'jury_influence'
  | 'finale_advantage'

/** Vote tally for a council. */
export interface SurvivorVoteTally {
  councilId: string
  votesByTarget: Record<string, number>
  tied: boolean
  eliminatedRosterId: string | null
  tieBreakSeasonPoints: Record<string, number> | null
  tiePhase?: string
  tiedRosterIds?: string[]
}

/** Council result after close. */
export interface SurvivorCouncilResult {
  councilId: string
  week: number
  phase: SurvivorPhase
  eliminatedRosterId: string
  voteCount: Record<string, number>
  tieBreakUsed: boolean
}

/** Exile token state. */
export interface SurvivorExileTokenState {
  rosterId: string
  tokens: number
  lastAwardedWeek: number | null
}

/** Challenge types for mini-games. */
export type SurvivorChallengeType =
  | 'score_prediction'
  | 'over_under'
  | 'player_prop'
  | 'tribe_vs'
  | 'immunity_auction'
  | 'puzzle'
  | 'trivia'
  | 'point_boost'
  | 'individual_safety'

/** Parsed @Chimmy command intent. */
export type SurvivorCommandIntent =
  | 'vote'
  | 'jury_vote'
  | 'play_idol'
  | 'sit_out_nominate'
  | 'challenge_pick'
  | 'immunity_choice'
  | 'confirm_minigame'
  | 'shot_in_the_dark'
  | 'unknown'

export interface SurvivorParsedCommand {
  intent: SurvivorCommandIntent
  targetRosterId?: string
  targetDisplayName?: string
  idolId?: string
  challengeId?: string
  playerDisplayName?: string
  secondaryPlayerDisplayName?: string
  payload?: Record<string, unknown>
  raw: string
}

/** Audit event types. */
export type SurvivorAuditEventType =
  | 'tribe_created'
  | 'tribe_shuffle'
  | 'idol_assigned'
  | 'idol_transferred'
  | 'idol_used'
  | 'idol_expired'
  | 'vote_submitted'
  | 'council_closed'
  | 'eliminated'
  | 'merge'
  | 'jury_joined'
  | 'exile_enrolled'
  | 'token_awarded'
  | 'token_reset'
  | 'return_to_island'
  | 'challenge_resolved'
  | 'challenge_reward_awarded'
  | 'idol_effect_applied'
  | 'jury_vote_submitted'
  | 'winner_crowned'
  | 'commissioner_override'
  | 'chat_membership_updated'
