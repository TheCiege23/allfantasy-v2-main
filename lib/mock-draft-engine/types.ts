/**
 * Mock draft engine types.
 * Supports NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */

export type MockDraftStatus = 'pre_draft' | 'in_progress' | 'paused' | 'completed'

type MockSlotType = 'human' | 'cpu'
export type MockRoomMode = 'solo' | 'cpu_only' | 'mixed' | 'linked_public'

export interface MockSlotConfigEntry {
  slot: number
  type: MockSlotType
  userId?: string | null
  displayName?: string | null
}

interface MockKeeperEntry {
  overall?: number
  round?: number
  slot?: number
  playerName: string
  position: string
  team?: string | null
  manager?: string | null
}

export interface MockDraftSettings {
  sport: string
  leagueType: string
  draftType: string
  numTeams: number
  rounds: number
  timerSeconds: number
  aiEnabled: boolean
  scoringFormat?: string
  leagueId?: string | null
  rosterSize?: number
  /** rookies | vets | all */
  poolType?: string
  roomMode?: MockRoomMode
  /** number of human-managed slots (mixed mode) */
  humanTeams?: number
  keepersEnabled?: boolean
  keepers?: MockKeeperEntry[]
}

export interface MockDraftPickSnapshot {
  round: number
  pick: number
  overall: number
  slot: number
  manager: string
  playerName: string
  position: string
  team?: string | null
  playerId?: string | null
  isUser: boolean
  isBotPick?: boolean
  source?: 'human' | 'cpu' | 'autopick' | 'keeper'
  createdAt?: string
}

export interface MockDraftProgressSnapshot {
  totalPicks: number
  completedPicks: number
  currentOverall: number | null
  currentRound: number | null
  currentSlot: number | null
  currentManager: string | null
  currentSlotType: MockSlotType | null
  isViewerOnClock: boolean
  timerEndsAt: string | null
  remainingSeconds: number | null
}

export interface MockDraftSummarySnapshot {
  draftId: string
  status: MockDraftStatus
  totalPicks: number
  completedPicks: number
  topPicks: MockDraftPickSnapshot[]
  picksByManager: Array<{
    manager: string
    slot: number
    totalPicks: number
    positions: Record<string, number>
  }>
}

export interface MockDraftSessionSnapshot {
  id: string
  status: MockDraftStatus
  inviteToken: string | null
  inviteLink: string | null
  canManage?: boolean
  shareId: string | null
  settings: MockDraftSettings
  slotConfig: MockSlotConfigEntry[]
  results: MockDraftPickSnapshot[]
  progress?: MockDraftProgressSnapshot
  summary?: MockDraftSummarySnapshot | null
  chatScope?: 'mock-only'
  rounds: number
  createdAt: string
  updatedAt: string
}
