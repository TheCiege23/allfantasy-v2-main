import type { DraftSessionSnapshot } from '@/lib/live-draft-engine/types'

export type DraftIntelTrigger =
  | 'manual'
  | 'n_minus_5'
  | 'pick_update'
  | 'on_clock'
  | 'recap'
  | 'reply'

export interface DraftIntelPredictedPickOption {
  playerName: string
  position: string
  team: string | null
  playerId: string | null
  probability: number
  reason: string
}

export interface DraftIntelPredictedPick {
  overall: number
  round: number
  slot: number
  rosterId: string
  displayName: string
  likely: DraftIntelPredictedPickOption | null
  alternative: DraftIntelPredictedPickOption | null
  reach: DraftIntelPredictedPickOption | null
}

export interface DraftIntelQueueEntry {
  rank: number
  playerName: string
  position: string
  team: string | null
  playerId: string | null
  availabilityProbability: number
  availabilityLabel: 'high' | 'medium' | 'low'
  reason: string
  isTaken?: boolean
  /** Set by the draft room from its player pool, for the face beside each suggestion. Never from the server. */
  headshotUrl?: string | null
  teamLogoUrl?: string | null
}

export interface DraftIntelDMPreview {
  ready: string
  update: string
  onClock: string
}

export interface DraftIntelState {
  leagueId: string
  userId: string
  rosterId: string
  leagueName: string | null
  sport: string
  sessionId: string | null
  status: 'idle' | 'active' | 'on_clock' | 'complete'
  trigger: DraftIntelTrigger
  currentOverall: number | null
  userNextOverall: number | null
  picksUntilUser: number | null
  generatedAt: string
  updatedAt: string
  headline: string
  queue: DraftIntelQueueEntry[]
  predictions: DraftIntelPredictedPick[]
  messages: DraftIntelDMPreview
  recap: string | null
  archived: boolean
  draftSession?: DraftSessionSnapshot | null
}

export interface DraftIntelStreamEnvelope {
  type: 'snapshot' | 'queue_update' | 'on_clock' | 'recap'
  leagueId: string
  userId: string
  state: DraftIntelState
}
