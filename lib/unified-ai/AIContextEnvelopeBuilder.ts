/**
 * AIContextEnvelopeBuilder — builds AIContextEnvelope from feature-specific inputs.
 * Ensures featureType, sport, and optional deterministic payload are always set.
 */

import { normalizeToSupportedSport } from "@/lib/sport-scope"
import type { AIContextEnvelope } from "./types"

type EnvelopeInput = {
  featureType: string
  sport?: string | null
  leagueId?: string | null
  userId?: string | null
  deterministicPayload?: Record<string, unknown> | null
  statisticsPayload?: Record<string, unknown> | null
  behaviorPayload?: Record<string, unknown> | null
  simulationPayload?: Record<string, unknown> | null
  rankingsPayload?: Record<string, unknown> | null
  promptIntent?: string
  uiSurface?: string
  confidenceMetadata?: AIContextEnvelope["confidenceMetadata"]
  dataQualityMetadata?: AIContextEnvelope["dataQualityMetadata"]
  hardConstraints?: string[]
  modelRoutingHints?: AIContextEnvelope["modelRoutingHints"]
  assistantRoutingHints?: AIContextEnvelope["assistantRoutingHints"]
  userMessage?: string
}

export function buildAIContextEnvelope(input: EnvelopeInput): AIContextEnvelope {
  const sport = normalizeToSupportedSport(input.sport)
  return {
    featureType: input.featureType,
    sport,
    leagueId: input.leagueId ?? null,
    userId: input.userId ?? null,
    deterministicPayload: input.deterministicPayload ?? null,
    statisticsPayload: input.statisticsPayload ?? null,
    behaviorPayload: input.behaviorPayload ?? null,
    simulationPayload: input.simulationPayload ?? null,
    rankingsPayload: input.rankingsPayload ?? null,
    promptIntent: input.promptIntent,
    uiSurface: input.uiSurface,
    confidenceMetadata: input.confidenceMetadata ?? null,
    dataQualityMetadata: input.dataQualityMetadata ?? null,
    hardConstraints: input.hardConstraints ?? [],
    modelRoutingHints: input.modelRoutingHints,
    assistantRoutingHints: input.assistantRoutingHints,
    userMessage: input.userMessage,
  }
}

