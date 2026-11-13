/**
 * Provider input and output contracts — every AI tool receives the same input shape
 * and must produce (or be normalized to) the same output shape.
 */

import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type {
  DeterministicContextEnvelope,
  EvidenceBlock,
  EvidenceItem,
  Confidence,
  UncertaintyBlock,
  MissingDataBlock,
  NormalizedToolOutput,
} from './schema'
import {
  DeterministicContextEnvelopeSchema,
  NormalizedToolOutputSchema,
} from './schema'

/** Provider input contract: what every AI provider receives for tools that require deterministic context. */
export interface ProviderInputContract {
  /** Deterministic context envelope; required for trade, waiver, draft, matchup, rankings, story (where factual grounding exists). */
  envelope: DeterministicContextEnvelope
  /** User message or prompt suffix. */
  userMessage?: string
  /** Intent: explain | recommend | compare | summarize. */
  intent?: string
  /** System prompt must include: use only envelope facts; do not invent metrics; surface uncertainty when confidence is capped. */
  systemPromptSuffix?: string
}

/**
 * Build the mandatory system-prompt suffix so no provider can bypass deterministic context.
 * Call this when building the system prompt for tools that require grounding.
 */
export function getMandatorySystemPromptSuffix(envelope: DeterministicContextEnvelope): string {
  const lines: string[] = [
    'RULES: Use only the facts and numbers provided in the deterministic context. Do not invent or assume any metrics, scores, or rankings not explicitly given. If confidence is marked as capped or uncertainty/missing data is listed, mention those limitations in your response. Do not state high confidence when the context indicates limited data.',
  ]
  if (envelope.hardConstraints?.length) {
    lines.push('', 'HARD CONSTRAINTS (do not override):', ...envelope.hardConstraints.map((c) => `- ${c}`))
  }
  if (envelope.uncertainty?.summaryForAI) {
    lines.push('', 'UNCERTAINTY (must acknowledge if relevant):', envelope.uncertainty.summaryForAI)
  }
  if (envelope.missingData?.summaryForAI) {
    lines.push('', 'MISSING DATA (do not fill in):', envelope.missingData.summaryForAI)
  }
  return lines.join('\n')
}

/** Provider output contract: raw provider response before normalization. */
export interface ProviderRawOutput {
  primaryAnswer?: string
  verdict?: string
  keyEvidence?: string[]
  evidence?: EvidenceItem[]
  confidencePct?: number
  confidenceLabel?: 'low' | 'medium' | 'high'
  confidenceReason?: string
  risksCaveats?: string[]
  caveats?: string[]
  suggestedNextAction?: string
  alternatePath?: string
  [key: string]: unknown
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)))
}

/**
 * Output normalization contract: normalize any provider output to NormalizedToolOutput
 * so that evidence block always renders if available, uncertainty when confidence limited,
 * missing data never silently ignored, caveats when capped.
 */
export function normalizeToContract(
  raw: ProviderRawOutput,
  envelope: DeterministicContextEnvelope,
  options?: { includeTrace?: boolean; traceProvider?: string }
): NormalizedToolOutput {
  const primaryAnswer = raw.primaryAnswer ?? raw.verdict ?? ''
  const verdict = raw.verdict ?? primaryAnswer.split('\n')[0]?.trim() ?? 'See analysis.'

  const envelopeEvidence: EvidenceItem[] = envelope.evidence?.items ?? []
  const hasEnvelopeEvidence = envelopeEvidence.length > 0
  const evidence: EvidenceItem[] =
    hasEnvelopeEvidence
      ? envelopeEvidence
      : raw.evidence && Array.isArray(raw.evidence)
      ? raw.evidence
      : []

  const keyEvidence: string[] =
    !hasEnvelopeEvidence && raw.keyEvidence && Array.isArray(raw.keyEvidence)
      ? raw.keyEvidence
      : evidence.map((e) => (e.unit ? `${e.label}: ${e.value} ${e.unit}` : `${e.label}: ${e.value}`))

  const uncertainty = envelope.uncertainty?.items ?? []
  const missingData = envelope.missingData?.items ?? []
  const hasDataLimitations = uncertainty.length > 0 || missingData.length > 0

  const envConf: Confidence | undefined = envelope.confidence
  const confidence: Confidence | undefined =
    envConf ?? (raw.confidencePct != null || raw.confidenceLabel
      ? {
          scorePct: typeof raw.confidencePct === 'number' ? clampScore(raw.confidencePct) : 50,
          label: raw.confidenceLabel ?? 'medium',
          reason: raw.confidenceReason,
          cappedByData: undefined,
          capReason: undefined,
        }
      : {
          scorePct: hasDataLimitations ? 45 : 60,
          label: hasDataLimitations ? 'low' : 'medium',
          reason: hasDataLimitations
            ? 'Confidence is capped because deterministic data is incomplete.'
            : 'No deterministic confidence score was provided.',
          cappedByData: hasDataLimitations || undefined,
          capReason: hasDataLimitations
            ? `Missing/uncertain data: ${missingData.length} missing, ${uncertainty.length} uncertain.`
            : undefined,
        })

  const caveats: string[] = []
  if (Array.isArray(raw.risksCaveats)) caveats.push(...raw.risksCaveats)
  if (Array.isArray(raw.caveats)) caveats.push(...raw.caveats)
  if (confidence?.cappedByData && confidence?.capReason) {
    const capNote = `Confidence is limited: ${confidence.capReason}`
    if (!caveats.some((c) => c.includes(confidence.capReason!))) caveats.unshift(capNote)
  }
  if (missingData.length > 0 && !caveats.some((c) => c.toLowerCase().includes('missing'))) {
    caveats.push(`Some data was missing for this analysis (${missingData.length} item(s)).`)
  }

  const trace =
    options?.includeTrace !== false && (options?.includeTrace || envelope.envelopeId)
      ? {
          envelopeId: envelope.envelopeId,
          toolId: envelope.toolId,
          dataQualitySummary: envelope.dataQualitySummary,
          providerUsed: options?.traceProvider,
        }
      : undefined

  const normalized: NormalizedToolOutput = {
    primaryAnswer,
    verdict,
    evidence: evidence.length > 0 ? evidence : undefined,
    keyEvidence: keyEvidence.length > 0 ? keyEvidence : undefined,
    confidence,
    uncertainty: uncertainty.length > 0 ? uncertainty : undefined,
    missingData: missingData.length > 0 ? missingData : undefined,
    caveats: caveats.length > 0 ? caveats : undefined,
    suggestedNextAction: raw.suggestedNextAction,
    alternatePath: raw.alternatePath,
    trace,
  }
  const parsed = NormalizedToolOutputSchema.safeParse(normalized)
  return parsed.success ? parsed.data : normalized
}

/**
 * Build a minimal envelope from tool-specific context (e.g. trade context, waiver context).
 * Use this when the tool already has a context object; we add evidence/confidence/uncertainty/missingData.
 */
export function buildEnvelopeFromTool(
  toolId: string,
  sport: string,
  opts: {
    leagueId?: string | null
    userId?: string | null
    evidence?: EvidenceBlock
    confidence?: Confidence
    uncertainty?: UncertaintyBlock
    missingData?: MissingDataBlock
    deterministicPayload?: Record<string, unknown> | null
    hardConstraints?: string[]
    envelopeId?: string
    dataQualitySummary?: string
  }
): DeterministicContextEnvelope {
  const envelope: DeterministicContextEnvelope = {
    toolId,
    sport: normalizeToSupportedSport(sport),
    leagueId: opts.leagueId ?? null,
    userId: opts.userId ?? null,
    evidence: opts.evidence,
    confidence: opts.confidence,
    uncertainty: opts.uncertainty,
    missingData: opts.missingData,
    deterministicPayload: opts.deterministicPayload ?? null,
    hardConstraints: opts.hardConstraints ?? [],
    envelopeId: opts.envelopeId,
    dataQualitySummary: opts.dataQualitySummary,
  }
  const parsed = DeterministicContextEnvelopeSchema.safeParse(envelope)
  return parsed.success ? parsed.data : envelope
}

/**
 * Build and validate provider input contract from deterministic envelope.
 */
export function toProviderInputContract(input: {
  envelope: DeterministicContextEnvelope
  userMessage?: string
  intent?: string
}): ProviderInputContract {
  const parsed = DeterministicContextEnvelopeSchema.safeParse(input.envelope)
  const envelope = parsed.success ? parsed.data : input.envelope
  return {
    envelope,
    userMessage: input.userMessage,
    intent: input.intent,
    systemPromptSuffix: getMandatorySystemPromptSuffix(envelope),
  }
}

/**
 * Safe frontend/debug envelope (omit raw deterministicPayload by default).
 */
export function toClientDeterministicEnvelope(
  envelope: DeterministicContextEnvelope,
  options?: { includePayload?: boolean }
): DeterministicContextEnvelope {
  return {
    ...envelope,
    deterministicPayload: options?.includePayload ? envelope.deterministicPayload : null,
  }
}
