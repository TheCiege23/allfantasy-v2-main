import { prisma } from '@/lib/prisma'
import { buildRedraftWarRoomContext } from '@/lib/redraft-war-room/redraftWarRoomContext'
import { evaluateTeamNeeds } from '@/lib/redraft-war-room/redraftTeamNeedsEngine'
import { buildWaiverRecommendations } from '@/lib/redraft-war-room/redraftWaiverEngine'

type ConfidenceLevel = 'high' | 'medium' | 'low'

export type WaiverRec = {
  addPlayerId: string
  addPlayerName: string
  position: string
  reason: string
  confidence: ConfidenceLevel
  value: number | null
  valueSource: string
  faabBidSuggestion: number | null
  faabBand: string | null
  prioritySuggestion: number | null
  priorityGuidance: string | null
  explanation: string[]
}

export type SuggestedDrop = {
  dropPlayerId: string
  dropPlayerName: string
  position: string
  reason: string
  value: number | null
}

export type WaiverAnalysis = {
  rosterId: string
  seasonId: string
  leagueId: string
  requestedWeek: number
  analysisWeek: number
  confidence: ConfidenceLevel
  rankedAdds: WaiverRec[]
  suggestedDrops: SuggestedDrop[]
  addDropPairs: Array<{ add: string; drop: string; rationale: string }>
  faabGuidance: {
    enabled: boolean
    budget: number | null
    remaining: number | null
    topBidSuggestion: number | null
    note: string
  }
  rosterFit: {
    targetPositions: string[]
    criticalNeeds: string[]
    weakBenchPlayers: string[]
  }
  risks: string[]
  dataWarnings: string[]
  source: 'deterministic_redraft_war_room'
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
}

function normalizeConfidence(values: ConfidenceLevel[]): ConfidenceLevel {
  if (values.includes('high') && !values.includes('low')) return 'high'
  if (values.includes('medium') || values.includes('high')) return 'medium'
  return 'low'
}

export async function generateWaiverRecs(
  userId: string,
  rosterId: string,
  seasonId: string,
  week: number,
): Promise<WaiverAnalysis | null> {
  const season = await prisma.redraftSeason.findFirst({
    where: { id: seasonId },
    select: {
      id: true,
      leagueId: true,
      currentWeek: true,
    },
  })
  if (!season) return null

  const contextResult = await buildRedraftWarRoomContext({
    leagueId: season.leagueId,
    userId,
    seasonId: season.id,
  })
  if (!contextResult.ok) return null

  const context = contextResult.context
  const team = context.teams.find((candidate) => candidate.rosterId === rosterId)
  if (!team) return null

  const waiverResult = buildWaiverRecommendations(context, rosterId)
  const teamNeeds = evaluateTeamNeeds(context, rosterId)
  const rankedAdds: WaiverRec[] = waiverResult.recommendedAdds.map((add) => ({
    addPlayerId: add.playerId,
    addPlayerName: add.playerName,
    position: add.position,
    reason: add.reason,
    confidence: add.confidenceLevel,
    value: add.value,
    valueSource: add.valueSource,
    faabBidSuggestion: add.faabBidSuggestion,
    faabBand: add.faabBand,
    prioritySuggestion: add.prioritySuggestion,
    priorityGuidance: add.priorityGuidance ?? null,
    explanation: add.explanation,
  }))
  const suggestedDrops: SuggestedDrop[] = waiverResult.recommendedDrops.map((drop) => ({
    dropPlayerId: drop.playerId,
    dropPlayerName: drop.playerName,
    position: drop.position,
    reason: drop.reason,
    value: drop.value,
  }))

  const dataWarnings = uniqueStrings([
    ...waiverResult.missingDataFlags,
    week !== context.currentWeek
      ? `Analysis used current league week ${context.currentWeek}; requested week ${week} is not separately materialized yet.`
      : null,
    waiverResult.needsProviderIntegration
      ? 'Waiver add targets are limited until the free-agent pool is fully synced for this league.'
      : null,
  ])
  const weakBenchPlayers = suggestedDrops.slice(0, 3).map((drop) => drop.dropPlayerName)
  const criticalNeeds = teamNeeds.needs
    .filter((need) => need.severity === 'critical')
    .map((need) => `${need.position}: ${need.reason}`)
  const faabEnabled = context.waivers.type === 'faab'
  const topBidSuggestion = rankedAdds[0]?.faabBidSuggestion ?? null
  const confidence = normalizeConfidence(rankedAdds.map((add) => add.confidence))

  return {
    rosterId,
    seasonId: season.id,
    leagueId: season.leagueId,
    requestedWeek: week,
    analysisWeek: context.currentWeek,
    confidence,
    rankedAdds,
    suggestedDrops,
    addDropPairs: waiverResult.addDropPairs,
    faabGuidance: {
      enabled: faabEnabled,
      budget: context.waivers.faabBudget,
      remaining: team.faabBalance ?? null,
      topBidSuggestion,
      note: faabEnabled
        ? topBidSuggestion != null
          ? `Top recommendation suggests ${topBidSuggestion} FAAB based on current needs and available budget.`
          : 'FAAB is enabled, but no confident bid can be suggested until a waiver target is available.'
        : `League uses ${context.waivers.type} waivers, so priority guidance matters more than bid sizing.`,
    },
    rosterFit: {
      targetPositions: waiverResult.targetPositions,
      criticalNeeds,
      weakBenchPlayers,
    },
    risks: waiverResult.riskFlags,
    dataWarnings,
    source: 'deterministic_redraft_war_room',
  }
}
