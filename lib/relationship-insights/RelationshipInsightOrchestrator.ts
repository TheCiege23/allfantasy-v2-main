import { prisma } from '@/lib/prisma'
import { buildLeagueGraph } from '@/lib/league-intelligence-graph'
import { runRivalryEngine } from '@/lib/rivalry-engine/RivalryEngine'
import { runLeagueDramaEngine } from '@/lib/drama-engine/LeagueDramaEngine'
import { normalizeSportForRelationship } from './SportRelationshipResolver'
import { syncRivalryEdgesIntoGraph } from './GraphRivalryBridge'

export interface RelationshipInsightOrchestratorInput {
  leagueId: string
  sport?: string | null
  season?: number | null
  rebuildGraph?: boolean
  runRivalry?: boolean
  runDrama?: boolean
  syncGraphRivalryEdges?: boolean
}

export interface RelationshipInsightOrchestratorResult {
  leagueId: string
  sport: string
  season: number
  graphRebuilt: boolean
  rivalry?: { processed: number; created: number; updated: number }
  drama?: { created: number; updated: number; eventIds: string[] }
  graphRivalryBridge?: { linkedRivalries: number; upsertedEdges: number; skipped: number }
}

export async function runRelationshipInsightOrchestrator(
  input: RelationshipInsightOrchestratorInput
): Promise<RelationshipInsightOrchestratorResult> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { sport: true, season: true },
  })
  if (!league) {
    throw new Error('League not found')
  }

  const sport = normalizeSportForRelationship(input.sport ?? league.sport ?? null)
  const season = input.season ?? league.season ?? new Date().getUTCFullYear()

  const out: RelationshipInsightOrchestratorResult = {
    leagueId: input.leagueId,
    sport,
    season,
    graphRebuilt: false,
  }

  if (input.rebuildGraph) {
    await buildLeagueGraph({
      leagueId: input.leagueId,
      season,
      includeTrades: true,
      includeRivalries: true,
    })
    out.graphRebuilt = true
  }

  if (input.runRivalry) {
    const result = await runRivalryEngine({
      leagueId: input.leagueId,
      sport,
      seasons: [season],
    })
    out.rivalry = {
      processed: result.processed,
      created: result.created,
      updated: result.updated,
    }
  }

  if (input.runDrama) {
    const result = await runLeagueDramaEngine({
      leagueId: input.leagueId,
      sport,
      season,
      replace: false,
    })
    out.drama = result
  }

  // `runProfiles` (the personality-profile engine, run per team) was removed 2026-11-19 with that engine — re-score
  // build item 10. A request that still sends it is ignored.

  if (input.syncGraphRivalryEdges) {
    out.graphRivalryBridge = await syncRivalryEdgesIntoGraph({
      leagueId: input.leagueId,
      sport,
      season,
      limit: 250,
    })
  }

  return out
}
