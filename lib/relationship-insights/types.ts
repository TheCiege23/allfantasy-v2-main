import type { DramaEventView } from '@/lib/drama-engine/DramaQueryService'
import type { RivalryRecordView } from '@/lib/rivalry-engine/RivalryQueryService'
import type { ManagerPsychProfileView } from '@/lib/psychological-profiles/ManagerBehaviorQueryService'
import type { LeagueRelationshipProfile } from '@/lib/league-intelligence-graph'

export interface BehaviorDramaManagerContext {
  managerId: string
  profile: ManagerPsychProfileView | null
  dramaEvents: DramaEventView[]
  behaviorHeat: number
}

/**
 * What a relationship response may say about a manager's behaviour (Milestone 32):
 * which drama involves them. Never the profile, its labels or its scores.
 */
export interface PublicBehaviorDramaContext {
  managerId: string
  dramaEvents: DramaEventView[]
}

/** Profile coverage only — that a profile exists for this manager, never what it says. */
export interface PublicProfileCoverage {
  id: string
  managerId: string
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
  profiles: PublicProfileCoverage[]
  drama: DramaEventView[]
  behaviorDramaContext: PublicBehaviorDramaContext[]
  storylines: UnifiedStorylineRecord[]
}
