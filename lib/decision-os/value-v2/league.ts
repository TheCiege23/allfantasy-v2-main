import type { ScoringRule, StartingSlot } from './types'

export interface LeagueRuntimeV2 {
  leagueId: string
  fingerprint: string | null
  teamCount: number | null
  scoring: ScoringRule[] | null
  slots: StartingSlot[] | null
  benchSlots: number | null
  reserveSlots: number | null
  taxiSlots: number | null
  gaps: string[]
}

