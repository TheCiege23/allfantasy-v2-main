/**
 * Shared AI response normalizer — OrchestrationResult + provider meta → UnifiedAIResponse.
 */

import type { AIContextEnvelope, ModelOutput, OrchestrationResult } from '@/lib/unified-ai/types'
import type { ProviderStatusEntry, UnifiedAIResponse } from './types'
import { resolveProviderFailure } from '@/lib/ai-reliability/ProviderFailureResolver'
import type { ProviderResultMeta } from '@/lib/ai-reliability/types'
import { resolveConfidence as resolveReliabilityConfidence } from '@/lib/ai-reliability/AIConfidenceResolver'
import { blockUnsupportedClaim } from '@/lib/ai-reliability/AIFactGuard'
import { resolveConsensusDisagreement } from '@/lib/ai-reliability/ConsensusDisagreementResolver'
import { buildReliabilityMetadata } from '@/lib/ai-reliability/AIResultStabilityService'
import { runAIQASystem } from '@/lib/ai-qa-system'

export interface NormalizerInput {
  result: OrchestrationResult
  providerResults: ProviderResultMeta[]
  envelope?: AIContextEnvelope
  traceId?: string
  cached?: boolean
}

/**
 * Convert provider results to status entries (no secrets).
 */
function toStatusEntries(providerResults: ProviderResultMeta[]): ProviderStatusEntry[] {
  return providerResults.map((r) => ({
    provider: r.provider,
    status: r.status,
    error: r.error,
    latencyMs: r.latencyMs,
  }))
}

/**
 * Extract keyEvidence, risksCaveats, verdict, suggestedNextAction, and PROMPT 123 required fields from modelOutputs.structured.
 */
function extractStructured(result: OrchestrationResult): Pick<
  UnifiedAIResponse,
  'keyEvidence' | 'risksCaveats' | 'verdict' | 'suggestedNextAction' | 'evidence' | 'valueVerdict' | 'viabilityVerdict' | 'actionPlan' | 'confidenceScore' | 'uncertaintyExplanation'
> {
  const out: Pick<
    UnifiedAIResponse,
    'keyEvidence' | 'risksCaveats' | 'verdict' | 'suggestedNextAction' | 'evidence' | 'valueVerdict' | 'viabilityVerdict' | 'actionPlan' | 'confidenceScore' | 'uncertaintyExplanation'
  > = {}
  for (const o of result.modelOutputs) {
    const s = o.structured
    if (!s || typeof s !== 'object') continue
    if (Array.isArray(s.keyEvidence) && s.keyEvidence.length && !out.keyEvidence) {
      out.keyEvidence = s.keyEvidence.slice(0, 10) as string[]
    }
    if (Array.isArray(s.evidence) && s.evidence.length && !out.evidence) {
      out.evidence = (s.evidence as string[]).slice(0, 15)
    }
    if (Array.isArray(s.risksCaveats) && s.risksCaveats.length && !out.risksCaveats) {
      out.risksCaveats = s.risksCaveats.slice(0, 5) as string[]
    }
    if (typeof s.verdict === 'string' && !out.verdict) out.verdict = s.verdict
    if (typeof s.valueVerdict === 'string' && !out.valueVerdict) out.valueVerdict = s.valueVerdict
    if (typeof s.viabilityVerdict === 'string' && !out.viabilityVerdict) out.viabilityVerdict = s.viabilityVerdict
    if (typeof s.suggestedNextAction === 'string' && !out.suggestedNextAction) {
      out.suggestedNextAction = s.suggestedNextAction
    }
    if (typeof s.actionPlan === 'string' && !out.actionPlan) out.actionPlan = s.actionPlan
    if (typeof s.confidenceScore === 'number' && out.confidenceScore == null) out.confidenceScore = s.confidenceScore
    if (typeof s.uncertaintyExplanation === 'string' && !out.uncertaintyExplanation) {
      out.uncertaintyExplanation = s.uncertaintyExplanation
    }
  }
  return out
}

function toConfidenceLabel(score: number): 'low' | 'medium' | 'high' {
  if (score >= 75) return 'high'
  if (score < 50) return 'low'
  return 'medium'
}

function detectStaleFlags(envelope?: AIContextEnvelope): {
  staleAny: boolean
  injuryDataStale: boolean
  valuationDataStale: boolean
  adpDataStale: boolean
} {
  const staleAny = Boolean(envelope?.dataQualityMetadata?.stale)
  const missing = envelope?.dataQualityMetadata?.missing ?? []
  const injuryDataStale = staleAny && missing.some((item) => /injur/i.test(item))
  const valuationDataStale = staleAny && missing.some((item) => /valu|trade|market/i.test(item))
  const adpDataStale = staleAny && missing.some((item) => /adp|draft/i.test(item))
  return { staleAny, injuryDataStale, valuationDataStale, adpDataStale }
}

function estimateDataCoveragePercent(envelope?: AIContextEnvelope): number | undefined {
  if (!envelope?.dataQualityMetadata) return undefined
  const missingCount = envelope.dataQualityMetadata.missing?.length ?? 0
  const stalePenalty = envelope.dataQualityMetadata.stale ? 20 : 0
  return Math.max(20, Math.min(100, 100 - missingCount * 10 - stalePenalty))
}

function inferVerdict(raw: string, structured?: Record<string, unknown> | null): string {
  if (structured?.verdict && typeof structured.verdict === 'string') {
    return structured.verdict
  }
  if (structured?.valueVerdict && typeof structured.valueVerdict === 'string') {
    return structured.valueVerdict
  }
  if (structured?.viabilityVerdict && typeof structured.viabilityVerdict === 'string') {
    return structured.viabilityVerdict
  }
  const lowered = (raw ?? '').toLowerCase()
  if (/\b(reject|decline|do not|avoid|pass)\b/.test(lowered)) return 'reject'
  if (/\b(accept|approve|take)\b/.test(lowered)) return 'accept'
  if (/\b(hold|wait|neutral|even)\b/.test(lowered)) return 'hold'
  return 'mixed'
}

function extractProviderAlternates(
  modelOutputs: ModelOutput[],
  primaryAnswer: string
): Array<{ provider: string; text: string }> {
  return modelOutputs
    .filter((o) => !o.skipped && !o.error && typeof o.raw === 'string' && o.raw.trim().length > 0)
    .filter((o) => o.raw.trim() !== primaryAnswer.trim())
    .slice(0, 3)
    .map((o) => ({
      provider: o.model,
      text: o.raw.trim().slice(0, 800),
    }))
}

/**
 * Build UnifiedAIResponse from orchestration result and provider metadata.
 */
export function normalizeToUnifiedResponse(input: NormalizerInput): UnifiedAIResponse {
  const { result, providerResults, envelope, traceId, cached } = input
  const failure = resolveProviderFailure(providerResults)
  const allProvidersFailed = providerResults.length > 0 && providerResults.every((provider) => provider.status !== 'ok')
  const usedDeterministicFallback = !!result.usedDeterministic && allProvidersFailed

  const structured = extractStructured(result)
  const dataCoveragePercent = estimateDataCoveragePercent(envelope)
  const staleFlags = detectStaleFlags(envelope)
  const confidenceSourceCandidate =
    typeof structured.confidenceScore === 'number' ? structured.confidenceScore : result.confidencePct
  const confidenceResolution = resolveReliabilityConfidence({
    deterministicConfidence: typeof result.confidencePct === 'number' ? result.confidencePct : 60,
    llmConfidence: allProvidersFailed ? undefined : confidenceSourceCandidate,
    dataCoveragePercent,
    missingDataCount: envelope?.dataQualityMetadata?.missing?.length ?? 0,
    injuryDataStale: staleFlags.injuryDataStale,
    valuationDataStale: staleFlags.valuationDataStale,
    adpDataStale: staleFlags.adpDataStale,
    providerResults,
  })
  const confidenceWarnings = confidenceResolution.factGuard.violations.map((v) => v.detail)
  const preQaWarnings = Array.from(new Set([...(result.factGuardWarnings ?? []), ...confidenceWarnings]))
  const qa = runAIQASystem({
    primaryAnswer: result.primaryAnswer,
    modelOutputs: result.modelOutputs,
    envelope,
    factGuardWarnings: preQaWarnings,
  })
  const qaWarnings = qa.warnings.map((warning) => `[AI QA] ${warning}`)
  const factGuardWarnings = Array.from(new Set([...preQaWarnings, ...qaWarnings]))
  let confidencePct = confidenceResolution.finalConfidence
  if (!qa.verification.noHallucinations) {
    confidencePct = Math.min(confidencePct, 55)
  }
  if (!qa.verification.correctDataUsage) {
    confidencePct = Math.min(confidencePct, 65)
  }
  if (!qa.verification.consistentResponses) {
    confidencePct = Math.min(confidencePct, 70)
  }
  const confidenceLabel = result.confidenceLabel ?? toConfidenceLabel(confidencePct)
  const hardViolation =
    confidenceResolution.factGuard.blocked ||
    blockUnsupportedClaim(confidencePct, 20) ||
    factGuardWarnings.some((warning) => /unsupported|blocked/i.test(warning)) ||
    !qa.verification.noHallucinations

  const evidence = structured.evidence ?? structured.keyEvidence
  const actionPlan = structured.actionPlan ?? structured.suggestedNextAction
  const confidenceScore = confidencePct
  const confidenceReason =
    (confidenceWarnings.length ? confidenceWarnings.join('; ') : undefined) ||
    (!qa.passed ? `AI QA warnings: ${qa.warnings.slice(0, 2).join('; ')}` : undefined) ||
    (confidenceResolution.partialProviderFailure ? 'Confidence reduced due to partial provider failure.' : undefined) ||
    (staleFlags.staleAny ? 'Confidence reduced because some source data may be stale.' : undefined) ||
    result.reason

  const disagreementCandidates = result.modelOutputs
    .filter((o) => !o.skipped && !o.error && typeof o.raw === 'string' && o.raw.trim().length > 0)
    .map((output) => ({
      provider: output.model,
      verdict: inferVerdict(output.raw, output.structured),
      confidence:
        typeof output.structured?.confidenceScore === 'number'
          ? Math.max(0, Math.min(100, output.structured.confidenceScore))
          : confidencePct,
    }))
  const disagreement =
    disagreementCandidates.length >= 2 ? resolveConsensusDisagreement(disagreementCandidates) : undefined

  const fallbackExplanation = allProvidersFailed
    ? usedDeterministicFallback
      ? 'Chimmy providers are temporarily unavailable. Showing deterministic (data-only) guidance while preserving tool output.'
      : 'Chimmy providers are temporarily unavailable and no deterministic fallback is available yet. Please retry.'
    : undefined

  const reliability = buildReliabilityMetadata({
    providerResults,
    confidence: confidencePct,
    usedDeterministicFallback,
    fallbackExplanation,
    dataQualityWarnings: factGuardWarnings,
    hardViolation,
  })

  const uncertaintyExplanation = structured.uncertaintyExplanation
    ?? (factGuardWarnings.length
      ? factGuardWarnings.join('. ')
      : Array.isArray(structured.risksCaveats) && structured.risksCaveats.length
        ? structured.risksCaveats.join('. ')
        : undefined)

  const alternateOutputs = disagreement?.hasDisagreement
    ? extractProviderAlternates(result.modelOutputs, result.primaryAnswer)
    : []

  return {
    primaryAnswer: result.primaryAnswer,
    confidencePct,
    confidenceLabel,
    confidenceReason,
    verdict: structured.verdict,
    keyEvidence: structured.keyEvidence,
    risksCaveats: structured.risksCaveats,
    suggestedNextAction: structured.suggestedNextAction,
    evidence,
    valueVerdict: structured.valueVerdict,
    viabilityVerdict: structured.viabilityVerdict,
    actionPlan,
    confidenceScore,
    uncertaintyExplanation,
    modelOutputs: result.modelOutputs,
    reliability: {
      usedDeterministicFallback: reliability.usedDeterministicFallback,
      providerStatus: toStatusEntries(providerResults),
      message: failure.message || undefined,
      fallbackExplanation: reliability.fallbackExplanation,
      dataQualityWarnings: reliability.dataQualityWarnings,
      hardViolation: reliability.hardViolation,
      confidence: reliability.confidence,
      confidenceSource: confidenceResolution.source,
      disagreement: disagreement ?? undefined,
      aiQa: qa,
      partialProviderFailure: confidenceResolution.partialProviderFailure,
    },
    alternateOutputs,
    factGuardWarnings,
    traceId,
    cached: !!cached,
    mode: result.mode,
  }
}
