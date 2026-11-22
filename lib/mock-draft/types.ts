/**
 * Mock draft config and state types.
 * Used by setup flow, engine, and recap.
 */

export type MockDraftSport = 'NFL' | 'NHL' | 'NBA' | 'MLB' | 'NCAAB' | 'NCAAF' | 'SOCCER'

export type MockLeagueType = 'redraft' | 'dynasty'

export type MockDraftType = 'snake' | 'linear' | 'auction'

export type MockScoringFormat = 'ppr' | 'half-ppr' | 'standard' | 'sf' | 'tep' | 'default'

/** Player pool filter: all | rookies | vets (sport-dependent) */
export type MockPoolType = 'all' | 'rookies' | 'vets'

export interface MockDraftConfig {
  sport: MockDraftSport
  leagueType: MockLeagueType
  draftType: MockDraftType
  numTeams: number
  scoringFormat: MockScoringFormat
  /** Timer seconds per pick (0 = no timer) */
  timerSeconds: number
  /** AI assistant on/off */
  aiEnabled: boolean
  /** Number of rounds */
  rounds: number
  /** Optional league id when mock is tied to a league */
  leagueId?: string | null
  /** Roster size (total slots) if configurable */
  rosterSize?: number
  /** all | rookies | vets */
  poolType?: MockPoolType
  /** solo | mixed | linked_public | cpu_only */
  roomMode?: 'solo' | 'mixed' | 'linked_public' | 'cpu_only'
  /** Number of human slots in mixed mode */
  humanTeams?: number
  /** Optional explicit room slots */
  slotConfig?: Array<{
    slot: number
    type: 'human' | 'cpu'
    userId?: string | null
    displayName?: string | null
  }>
}

export const DEFAULT_MOCK_CONFIG: MockDraftConfig = {
  sport: 'NFL',
  leagueType: 'redraft',
  draftType: 'snake',
  numTeams: 12,
  scoringFormat: 'default',
  timerSeconds: 60,
  aiEnabled: true,
  rounds: 15,
  leagueId: null,
  roomMode: 'solo',
  humanTeams: 1,
}

export interface MockDraftPick {
  round: number
  pick: number
  overall: number
  playerName: string
  position: string
  team: string
  manager: string
  managerAvatar?: string
  confidence?: number
  isUser: boolean
  value?: number
  notes?: string
  isBotPick?: boolean
}

