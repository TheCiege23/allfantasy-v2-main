/**
 * Build DeterministicContextEnvelope for waiver AI from quant + trend + league meta.
 * Evidence from quantitative result; uncertainty/missing when candidates lack data.
 */

import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type {
  DeterministicContextEnvelope,
  EvidenceBlock,
  EvidenceItem,
  Confidence,
  UncertaintyBlock,
  MissingDataBlock,
} from '../schema'

interface WaiverEnvelopeInput {
  sport?: string | null
  leagueId?: string | null
  userId?: string | null
  candidateCount: number
  /** Has quantitative scores (expected value, FAAB, etc.) */
  hasQuantResult?: boolean
  /** Has trend/must-add signals */
  hasTrendResult?: boolean
  /** Names or count of candidates missing quant data */
  missingQuantCandidates?: string[]
  strategyMode?: string
}

/**
 * Build a minimal envelope for waiver AI so provider receives deterministic context rules.
 */
export function buildWaiverEnvelope(input: WaiverEnvelopeInput): DeterministicContextEnvelope {
  const sport = normalizeToSupportedSport(input.sport ?? undefined)
  const items: EvidenceItem[] = []
  items.push({ source: 'waiver_engine', label: 'Candidates considered', value: input.candidateCount })
  if (input.hasQuantResult) items.push({ source: 'waiver_engine', label: 'Quantitative data', value: 'Available' })
  if (input.hasTrendResult) items.push({ source: 'waiver_engine', label: 'Trend signals', value: 'Available' })
  if (input.strategyMode) items.push({ source: 'waiver_engine', label: 'Strategy mode', value: input.strategyMode })

  const evidence: EvidenceBlock = {
    toolId: 'waiver_ai',
    items,
    summaryForAI: `Candidates: ${input.candidateCount}. Quant: ${input.hasQuantResult ? 'yes' : 'no'}. Trend: ${input.hasTrendResult ? 'yes' : 'no'}.`,
  }

  const missingQuant = input.missingQuantCandidates ?? []
  const confidenceScore = 40 + (input.hasQuantResult ? 25 : 0) + (input.hasTrendResult ? 15 : 0) - Math.min(missingQuant.length * 5, 30)
  const confidence: Confidence = {
    scorePct: Math.max(20, Math.min(85, confidenceScore)),
    label: confidenceScore >= 65 ? 'high' : confidenceScore >= 45 ? 'medium' : 'low',
    reason: missingQuant.length > 0 ? `${missingQuant.length} candidate(s) without quant data` : undefined,
    cappedByData: missingQuant.length > 0,
    capReason: missingQuant.length > 0 ? 'Missing quant data for some candidates' : undefined,
  }

  const uncertainty: UncertaintyBlock = {
    items: missingQuant.length > 0
      ? [{ what: `Quantitative scores for ${missingQuant.length} candidate(s)`, impact: 'medium' as const, reason: 'Priority is estimated.' }]
      : [],
  }

  const missingData: MissingDataBlock = {
    items: missingQuant.slice(0, 5).map((name) => ({
      what: `Quant data for ${name}`,
      impact: 'medium' as const,
      suggestedAction: 'Add league/roster context for better priority.',
    })),
  }

  return {
    toolId: 'waiver_ai',
    sport,
    leagueId: input.leagueId ?? null,
    userId: input.userId ?? null,
    evidence,
    confidence,
    uncertainty: uncertainty.items.length ? uncertainty : undefined,
    missingData: missingData.items.length ? missingData : undefined,
    hardConstraints: [
      'Do not invent expected value or FAAB numbers not provided.',
      'Use only the provided candidate list and any quantitative results.',
    ],
    envelopeId: `waiver-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    dataQualitySummary: `Candidates: ${input.candidateCount}; quant: ${input.hasQuantResult}; trend: ${input.hasTrendResult}; missing: ${missingQuant.length}`,
  }
}
