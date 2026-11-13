/**
 * [NEW] lib/tournament-mode/types.ts
 * Tournament Mode — type definitions for tournament creation, conferences, rounds, and hub.
 */

import { TOURNAMENT_PARTICIPANT_POOL_SIZES_EXTENDED } from './pool-sizes'

export type TournamentDraftType = 'snake' | 'auction'

/** Participant pools accepted by tournament creation flows. */
export const TOURNAMENT_PARTICIPANT_POOL_SIZES = TOURNAMENT_PARTICIPANT_POOL_SIZES_EXTENDED

export type ConferenceMode = 'black_vs_gold' | 'random_themed' | 'commissioner_custom'

export type LeagueNamingMode = 'commissioner_custom' | 'app_generated' | 'ai_themed'

/** Feeder leagues always use 12-team slots; kept for typing / display. */
export const TOURNAMENT_LEAGUE_SIZE_FIXED = 12 as const

export type TournamentPhase = 'qualification' | 'elimination' | 'elite_eight' | 'championship'

export interface TournamentSettings {
  draftType: TournamentDraftType
  participantPoolSize: number
  /**
   * Cosmetic / naming suggestion only at create time; defaults to black_vs_gold.
   * Does not block creation.
   */
  conferenceMode: ConferenceMode
  leagueNamingMode: LeagueNamingMode
  /** Always 12 — one feeder league holds exactly 12 managers before overflow to the next league. */
  initialLeagueSize: number
  /**
   * Managers advancing out of qualification (sport-aware, set at create).
   * Used for shell display and advancement scheduling.
   */
  qualificationAdvancementTotal?: number
  qualificationWeeks: number
  qualificationTiebreakers: string[]  // e.g. ['wins', 'points_for']
  bubbleWeekEnabled: boolean
  roundRedraftSchedule: number[]       // week numbers when redraft occurs
  finalsRedraftEnabled: boolean
  faabBudgetDefault: number
  faabResetByRound: boolean
  benchSpotsQualification: number
  benchSpotsElimination: number
  universalPageVisibility: 'public' | 'unlisted' | 'private'
  forumAnnouncementsEnabled: boolean
  bannerTheme?: string
  /** Top N advancing from each league in elimination rounds when calling condense (default 6 ≈ half of 12). */
  eliminationAdvancementPerLeague?: number
}

export interface TournamentHubSettings {
  visibility: 'public' | 'unlisted' | 'private'
  forumAnnouncements: boolean
  bannerTheme?: string
}

export interface TournamentConferenceTheme {
  primaryColor: string
  secondaryColor: string
  iconName?: string
  label: string
}

export interface CreateTournamentInput {
  name: string
  sport: string
  creatorId: string
  season?: number
  variant?: string
  settings: Partial<TournamentSettings>
  hubSettings?: Partial<TournamentHubSettings>
  conferenceNames?: [string, string]  // [Black, Gold] or custom
  leagueNames?: string[]             // commissioner custom names (one per league)
}

export interface InviteDistributionItem {
  leagueId: string
  leagueName: string
  conferenceName: string
  inviteCode: string | null
  joinUrl: string | null
}
