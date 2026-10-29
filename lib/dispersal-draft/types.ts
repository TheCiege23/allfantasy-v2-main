/**
 * Dispersal draft — orphaned / dissolved team asset pool and live draft state.
 */

export type DispersalScenario = 'orphan_teams' | 'league_downsizing'

export type DispersalAssetType = 'player' | 'draft_pick' | 'faab'

export type DispersalAsset = {
  id: string
  assetType: DispersalAssetType
  sourceRosterId: string

  playerId?: string
  playerName?: string
  playerPosition?: string
  playerTeam?: string

  pickId?: string
  pickRound?: number
  pickYear?: number
  originalOwnerRosterId?: string
  tradedToRosterId?: string
  pickLabel?: string
  isTradedPick?: boolean

  faabAmount?: number

  claimedByRosterId?: string | null
  claimedAt?: string | null
  isAvailable: boolean
}

export type DispersalDraftConfig = {
  leagueId: string
  scenario: DispersalScenario
  sourceRosterIds: string[]
  participantRosterIds: string[]
  orderMode: 'randomized' | 'commissioner_set'
  manualOrder?: string[]
  pickTimeSeconds: number
  autoPickOnTimeout: boolean
  /** Stored on draft row (e.g. linear); pick construction may still be linear until snake is implemented end-to-end. */
  draftType?: string
}

export type DispersalDraftState = {
  id: string
  leagueId: string
  scenario: DispersalScenario
  status: 'pending' | 'configuring' | 'in_progress' | 'completed' | 'cancelled'
  participantRosterIds: string[]
  passedRosterIds: string[]
  draftOrder: string[]
  currentPickIndex: number
  totalRounds: number
  picksPerRound: number
  assetPool: DispersalAsset[]
  sourceRosterIds: string[]
  picks: {
    pickNumber: number
    round: number
    pickInRound: number
    rosterId: string
    assetType?: string
    assetId?: string
    assetDisplayName?: string
    isPassed: boolean
    pickedAt?: string
    isAutoPick?: boolean
  }[]
  currentRosterId: string | null
  currentPickNumber: number
  isComplete: boolean
  startedAt: string | null
  completedAt: string | null
  pickTimeSeconds: number
  autoPickOnTimeout: boolean
  /**
   * When the current pick's clock runs out (`pickDeadlineFor`), the same instant for every viewer and for
   * the server's sweep. Null when no clock runs: not in progress, or no pick timer.
   */
  pickDeadlineAt: string | null
}
