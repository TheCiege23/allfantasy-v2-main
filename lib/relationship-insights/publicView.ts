import type { UnifiedRelationshipInsights } from './types'

/** Explicit projection: internal profile/behavior fields never reach league responses. */
export function publicRelationshipInsights(input: UnifiedRelationshipInsights) {
  return { leagueId: input.leagueId, sport: input.sport, season: input.season,
    relationshipProfile: input.relationshipProfile, rivalries: input.rivalries, drama: input.drama,
    profiles: [], behaviorDramaContext: [],
    storylines: input.storylines.map(s => ({ id: s.id, headline: s.headline, sport: s.sport, season: s.season,
      storylineScore: s.storylineScore, rivalryId: s.rivalryId, rivalryTier: s.rivalryTier, dramaEventId: s.dramaEventId, dramaType: s.dramaType,
      managerAId: s.managerAId, managerBId: s.managerBId, relatedManagerIds: s.relatedManagerIds,
      relatedTeamIds: s.relatedTeamIds, reasons: s.reasons.filter(r => !r.startsWith('Behavior heat ')) })),
  }
}
