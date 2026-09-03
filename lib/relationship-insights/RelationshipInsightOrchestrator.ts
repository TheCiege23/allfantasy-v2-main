import { prisma } from '@/lib/prisma'
import { buildLeagueGraph } from '@/lib/league-intelligence-graph'
import { runRivalryEngine } from '@/lib/rivalry-engine/RivalryEngine'
import { runLeagueDramaEngine } from '@/lib/drama-engine/LeagueDramaEngine'
import { runPsychologicalProfileEngine } from '@/lib/psychological-profiles/PsychologicalProfileEngine'
import { deriveLeagueFormat } from '@/lib/league-runtime/leagueFormat'
import { normalizeSportForRelationship } from './SportRelationshipResolver'
import { syncRivalryEdgesIntoGraph } from './GraphRivalryBridge'

export interface RelationshipInsightOrchestratorInput {
  leagueId: string
  sport?: string | null
  season?: number | null
  rebuildGraph?: boolean
  runRivalry?: boolean
  runDrama?: boolean
  runProfiles?: boolean
  syncGraphRivalryEdges?: boolean
}

export interface RelationshipInsightOrchestratorResult {
  leagueId: string
  sport: string
  season: number
  graphRebuilt: boolean
  rivalry?: { processed: number; created: number; updated: number }
  drama?: { created: number; updated: number; eventIds: string[] }
  profiles?: { total: number; success: number; failed: number }
  graphRivalryBridge?: { linkedRivalries: number; upsertedEdges: number; skipped: number }
}

export async function runRelationshipInsightOrchestrator(
  input: RelationshipInsightOrchestratorInput
): Promise<RelationshipInsightOrchestratorResult> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    include: { teams: true },
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

  if (input.runProfiles) {
    let success = 0
    let failed = 0
    for (const team of league.teams) {
      try {
        await runPsychologicalProfileEngine({
          leagueId: input.leagueId,
          managerId: team.externalId || team.id,
          sport,
          season,
          format: deriveLeagueFormat(league),
          sleeperUsername: team.ownerName,
        })
        success += 1
      } catch {
        failed += 1
      }
    }
    out.profiles = {
      total: league.teams.length,
      success,
      failed,
    }
  }

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
