import { getUnifiedRelationshipInsights } from './RelationshipQueryService'
import { getRelationshipSportLabel, normalizeOptionalSportForRelationship } from './SportRelationshipResolver'

export interface AIRelationshipContextInput {
  leagueId: string
  sport?: string | null
  season?: number | null
  focusManagerId?: string | null
  focusRivalryId?: string | null
  focusDramaEventId?: string | null
}

export interface AIRelationshipContextResult {
  promptContext: string
  payload: Record<string, unknown>
}

export async function buildAIRelationshipContext(
  input: AIRelationshipContextInput
): Promise<AIRelationshipContextResult> {
  const sport = normalizeOptionalSportForRelationship(input.sport)
  const insights = await getUnifiedRelationshipInsights({
    leagueId: input.leagueId,
    sport: sport ?? undefined,
    season: input.season,
    limit: 15,
    syncGraphRivalryEdges: true,
  })

  const filteredStorylines = insights.storylines.filter((s) => {
    if (input.focusRivalryId && s.rivalryId === input.focusRivalryId) return true
    if (input.focusDramaEventId && s.dramaEventId === input.focusDramaEventId) return true
    if (input.focusManagerId && s.relatedManagerIds.includes(input.focusManagerId)) return true
    if (input.focusRivalryId || input.focusDramaEventId || input.focusManagerId) return false
    return true
  })

  const payload = {
    leagueId: input.leagueId,
    sport: insights.sport,
    sportLabel: getRelationshipSportLabel(insights.sport),
    season: insights.season,
    focus: {
      managerId: input.focusManagerId ?? null,
      rivalryId: input.focusRivalryId ?? null,
      dramaEventId: input.focusDramaEventId ?? null,
    },
    profileSummary: {
      strongestRivalries: insights.relationshipProfile.strongestRivalries.slice(0, 5),
      influenceLeaders: insights.relationshipProfile.influenceLeaders.slice(0, 5),
      centralManagers: insights.relationshipProfile.centralManagers.slice(0, 8),
    },
    rivalries: insights.rivalries.slice(0, 10).map((r) => ({
      id: r.id,
      managerAId: r.managerAId,
      managerBId: r.managerBId,
      rivalryTier: r.rivalryTier,
      rivalryScore: r.rivalryScore,
    })),
    // Facts only: no profile labels, trait scores or behaviour heat reach the prompt (Milestone 32).
    behavior: insights.behaviorDramaContext.slice(0, 10).map((b) => ({
      managerId: b.managerId,
      dramaEventCount: b.dramaEvents.length,
    })),
    drama: insights.drama.slice(0, 12).map((d) => ({
      id: d.id,
      dramaType: d.dramaType,
      headline: d.headline,
      dramaScore: d.dramaScore,
      relatedManagerIds: d.relatedManagerIds,
      relatedTeamIds: d.relatedTeamIds,
    })),
    storylines: filteredStorylines.slice(0, 10),
  }

  const promptContext = JSON.stringify(payload)
  return { promptContext, payload }
}
