import type { DramaEventView } from '@/lib/drama-engine/DramaQueryService'
import type { RivalryRecordView } from '@/lib/rivalry-engine/RivalryQueryService'
import type { LeagueRelationshipProfile } from '@/lib/league-intelligence-graph'

/** Which drama involves a manager. Profile and "behaviour heat" removed 2026-11-19 (re-score build item 10). */
export interface BehaviorDramaManagerContext {
  managerId: string
  dramaEvents: DramaEventView[]
}

/**
 * What a relationship response may say about a manager's behaviour (Milestone 32):
 * which drama involves them. Never the profile, its labels or its scores.
 */
export interface PublicBehaviorDramaContext {
  managerId: string
  dramaEvents: DramaEventView[]
}

export interface UnifiedStorylineRecord {
  id: string
  headline: string
  sport: string
  season: number | null
  storylineScore: number
  rivalryId: string | null
  rivalryTier: string | null
  dramaEventId: string | null
  dramaType: string | null
  managerAId: string | null
  managerBId: string | null
  relatedManagerIds: string[]
  relatedTeamIds: string[]
  reasons: string[]
}

export interface UnifiedRelationshipInsights {
  leagueId: string
  sport: string | null
  season: number | null
  relationshipProfile: LeagueRelationshipProfile
  rivalries: RivalryRecordView[]
  drama: DramaEventView[]
  behaviorDramaContext: PublicBehaviorDramaContext[]
  storylines: UnifiedStorylineRecord[]
}
