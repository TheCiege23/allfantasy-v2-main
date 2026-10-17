import { buildLeagueRelationshipProfile } from '@/lib/league-intelligence-graph'
import { listDramaEvents } from '@/lib/drama-engine/DramaQueryService'
import { listProfilesByLeague } from '@/lib/psychological-profiles/ManagerBehaviorQueryService'
import { listRivalries } from '@/lib/rivalry-engine/RivalryQueryService'
import { buildBehaviorDramaContext } from './BehaviorDramaBridge'
import { syncRivalryEdgesIntoGraph } from './GraphRivalryBridge'
import { toPublicBehaviorDramaContext, toPublicProfileCoverage } from './publicView'
import { normalizeOptionalSportForRelationship } from './SportRelationshipResolver'
import { resolveUnifiedStorylines } from './UnifiedStorylineResolver'
import type { UnifiedRelationshipInsights } from './types'

export interface RelationshipQueryInput {
  leagueId: string
  sport?: string | null
  season?: number | null
  limit?: number
  syncGraphRivalryEdges?: boolean
}

export async function getUnifiedRelationshipInsights(
  input: RelationshipQueryInput
): Promise<UnifiedRelationshipInsights> {
  const sport = normalizeOptionalSportForRelationship(input.sport)
  if (input.syncGraphRivalryEdges) {
    await syncRivalryEdgesIntoGraph({
      leagueId: input.leagueId,
      sport: sport ?? undefined,
      season: input.season,
      limit: 250,
    }).catch(() => null)
  }

  const [relationshipProfile, rivalries, profiles, drama, storylines] = await Promise.all([
    buildLeagueRelationshipProfile({
      leagueId: input.leagueId,
      season: input.season ?? null,
      sport: sport ?? undefined,
      limits: {
        rivalries: 25,
        clusters: 12,
        influence: 20,
        central: 30,
        transitions: 20,
        elimination: 20,
      },
    }),
    listRivalries(input.leagueId, {
      sport: sport ?? undefined,
      season: input.season ?? undefined,
      limit: Math.max(20, input.limit ?? 40),
    }),
    listProfilesByLeague(input.leagueId, {
      sport: sport ?? undefined,
      season: input.season ?? undefined,
      limit: 200,
    }),
    listDramaEvents(input.leagueId, {
      sport: sport ?? undefined,
      season: input.season ?? undefined,
      limit: 80,
    }),
    resolveUnifiedStorylines({
      leagueId: input.leagueId,
      sport: sport ?? undefined,
      season: input.season,
      limit: input.limit ?? 25,
    }),
  ])

  const managerIds = [
    ...new Set(
      [
        ...rivalries.flatMap((r) => [r.managerAId, r.managerBId]),
        ...drama.flatMap((d) => d.relatedManagerIds),
      ].filter(Boolean)
    ),
  ]

  const behaviorDramaContext = await buildBehaviorDramaContext({
    leagueId: input.leagueId,
    sport: sport ?? undefined,
    season: input.season,
    managerIds,
    limitPerManager: 4,
  })

  return {
    leagueId: input.leagueId,
    sport: sport ?? null,
    season: input.season ?? null,
    relationshipProfile,
    rivalries,
    // Served to the client and to LLM context: coverage and facts only (publicView.ts).
    profiles: toPublicProfileCoverage(profiles),
    drama,
    behaviorDramaContext: toPublicBehaviorDramaContext(behaviorDramaContext),
    storylines,
  }
}
