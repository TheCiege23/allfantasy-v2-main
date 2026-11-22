/** Confirmed Survivor Guillotine rules. Separate from vote-based Survivor. */
export type SGSport = 'NFL' | 'NBA'
export type SGMode = 'match_play' | 'tribe_champion' | 'gauntlet' | 'merged' | 'final_three' | 'off'
export type SGPowerKind = 'personal_immunity' | 'ally_immunity' | 'steal_player' | 'tribe_swap' | 'faab_bonus'

export type SGExpansion = { enabled: boolean; openingBenchSlots: number | null; benchPerExpansion: number;
  steps: { period: number; slot: 'FLEX' | 'SUPERFLEX'; count: number }[] }
export type SGChallenge = { period: number; kind: 'tribe_blowout_faab' | 'highest_score_idol' | 'highest_score_swap'; amount: number }
export type SGSelectionStage = { tribeId: string; count: number; deadlineAt: string }
export type SGOrderChoice = { tribeId: string; deadlineAt: string; counts: [number, number, number];
  deadlines: [string, string, string]; selected?: 'bookends' | 'middle' }

export interface SGConfig {
  sport: SGSport
  teamCount: number
  tribeCount: number
  championshipPeriod: number
  gauntletPeriods: number
  mergedChopPeriods: number
  periodOverrides: Record<number, SGMode>
  tribeFormation: 'random' | 'commissioner' | 'captain_draft' | 'manager_choice'
  submissionMode: 'first_valid' | 'tribe_vote' | 'captain' | 'commissioner'
  matchupOrder: 'alternating' | 'random' | 'commissioner'
  matchupBatchSize: 2 | 3
  gauntletDraft: 'snake' | 'alternating' | 'commissioner'
  gauntletCaptains: 'previous_period_top_two' | 'commissioner'
  gauntletElimination: 'per_tribe' | 'league_lowest_two'
  gauntletTribeImmunity: boolean
  gauntletIdolAuction: boolean
  shufflePeriods: number[]
  faabBudget: number
  tradesEnabled: boolean
  nbaScoring: 'total_points' | 'capped_games'
  nbaGameCap: number
  ceremonyMode: 'automatic' | 'hosted'
  ceremonyPresentation: boolean
  immunityDeadline: 'scheduled_ceremony' | 'custom'
  customImmunityDeadline: string | null
  playerPowerDeadline: 'next_game_lock' | 'custom'
  customPlayerPowerDeadline: string | null
  missingSubmission: 'commissioner' | 'random'
  enabledPowers: SGPowerKind[]
  /** Optional extensions preserve seasons saved before the All-Stars update. */
  rosterExpansion?: SGExpansion
  rewardChallenges?: SGChallenge[]
  gauntletIdolMode?: 'sealed_auction' | 'retired_player'
  championRotation?: boolean
  waiverDelayHours?: number
}

export interface SGPeriod {
  period: number
  mode: SGMode
  teamsEntering: number
  teamsLeaving: number
  chops: number
  tribeImmunity: boolean
}

export interface SGTeam {
  id: string
  tribeId: string
  points: number
  previousPoints: number | null
  captain?: boolean
  champion?: boolean
  sitOut?: boolean
  satOutLastPeriod?: boolean
}

export interface SGMatchup { team1: string; team2: string }

export interface SGPower {
  id: string
  kind: SGPowerKind
  binding: 'player' | 'manager'
  playerId: string | null
  ownerId: string
  expiresAfterPeriod: number
  status: 'held' | 'sealed' | 'used' | 'expired'
  targetTeamId: string | null
  revealed: boolean
  source?: string
}
