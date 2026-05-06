/**
 * Types for the Waiver AI Engine (PROMPT 239).
 */

import type { WaiverRosterPlayer } from '@/lib/waiver-engine'
import type { TeamNeedsMap } from '@/lib/waiver-engine/team-needs'
import type { ScoredWaiverTarget } from '@/lib/waiver-engine/waiver-scoring'
import type { SupportedSport } from '@/lib/sport-scope'

export type { UserGoal } from '@/lib/waiver-engine/team-needs'

/** Input for the waiver AI suggestion engine. */
export type WaiverAIEngineInput = {
  sport?: SupportedSport | string
  roster?: WaiverRosterPlayer[] | null
  teamNeeds?: TeamNeedsMap | null
  rosterPositions?: string[]
  allLeagueRosters?: { players: WaiverRosterPlayer[] }[]
  currentWeek?: number
  goal?: 'win-now' | 'balanced' | 'rebuild'
  leagueSettings: {
    isSF?: boolean
    isTEP?: boolean
    numTeams?: number
    isDynasty?: boolean
  }
  availablePlayers: Array<{
    playerId?: string
    id?: string
    playerName?: string
    name?: string
    position?: string
    team?: string | null
    age?: number | null
    value?: number
    assetValue?: { impactValue?: number; marketValue?: number; vorpValue?: number; volatility?: number }
    source?: string
    /** Unified player snapshot from `serializeUnifiedPlayerForApi` (waiver wire UI). */
    product?: {
      unified?: Record<string, unknown>
      yearsExp?: number | null
      isRookie?: boolean
      byeWeek?: number | null
    }
    lowConfidence?: boolean
    profileSource?: string | null
    statsSource?: string | null
    fantasyPointsPerGame?: number | null
    injuryStatus?: string | null
  }>
  maxResults?: number
}

/** Result of suggestWaiverPickups. */
export type WaiverSuggestionsResult = {
  suggestions: ScoredWaiverTarget[]
}

/** Input for deterministic+AI waiver service. */
export type WaiverAIServiceInput = WaiverAIEngineInput & {
  includeAIExplanation?: boolean
}

/** Output for deterministic+AI waiver service. */
export type WaiverAIServiceOutput = {
  sport: SupportedSport
  deterministic: {
    suggestions: ScoredWaiverTarget[]
    basedOn: Array<'available_players' | 'team_needs'>
  }
  explanation: {
    source: 'deterministic' | 'ai'
    text: string
  }
}
