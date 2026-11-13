/**
 * Deterministic context envelope schema — shared across all AI tools.
 * AI cannot compute facts the deterministic layer should compute; AI cannot invent missing metrics.
 * Supported sports: NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER (use lib/sport-scope).
 */

import { z } from 'zod'
import { isSupportedSport } from '@/lib/sport-scope'

/** Supported tool identifiers that require deterministic grounding. */
export const AI_TOOL_IDS = [
  'trade_analyzer',
  'waiver_ai',
  'draft_helper',
  'matchup',
  'rankings',
  'story_creator',
  'content',
] as const

/** Single evidence item: source, label, value. No AI-invented values. */
const EvidenceItemSchema = z.object({
  /** Source of the fact (e.g. "trade_engine", "rankings_engine", "waiver_engine"). */
  source: z.string(),
  /** Human-readable label (e.g. "Fairness score", "VORP delta"). */
  label: z.string(),
  /** Value as string or number; must come from deterministic layer. */
  value: z.union([z.string(), z.number()]),
  /** Optional unit (e.g. "%", "pts"). */
  unit: z.string().optional(),
  /** Optional: how much this evidence contributes to confidence (0–100). */
  confidenceContribution: z.number().min(0).max(100).optional(),
})
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>

/** Evidence block: list of facts for display and for AI context. */
const EvidenceBlockSchema = z.object({
  /** Tool or feature that produced these facts. */
  toolId: z.string(),
  /** Ordered list of evidence items. */
  items: z.array(EvidenceItemSchema),
  /** Optional short summary for AI (e.g. "Fairness 72; accept probability 0.65"). */
  summaryForAI: z.string().optional(),
})
export type EvidenceBlock = z.infer<typeof EvidenceBlockSchema>

/** Confidence: must reflect data strength; capped when data is incomplete. */
const ConfidenceSchema = z.object({
  /** 0–100; must not be overstated when uncertainty or missing data present. */
  scorePct: z.number().min(0).max(100),
  /** low | medium | high. */
  label: z.enum(['low', 'medium', 'high']),
  /** Why this level (e.g. "Coverage 80%; injury data available"). */
  reason: z.string().optional(),
  /** When true, confidence was capped due to missing data or uncertainty. */
  cappedByData: z.boolean().optional(),
  /** Source of the cap (e.g. "missing_valuations", "stale_injury"). */
  capReason: z.string().optional(),
})
export type Confidence = z.infer<typeof ConfidenceSchema>

/** Single uncertainty: what is uncertain and its impact. */
const UncertaintyItemSchema = z.object({
  /** What is uncertain (e.g. "Future pick value", "Injury timeline"). */
  what: z.string(),
  /** Impact on recommendation: high | medium | low. */
  impact: z.enum(['high', 'medium', 'low']),
  /** Short reason (e.g. "Draft order not yet set"). */
  reason: z.string().optional(),
})
export type UncertaintyItem = z.infer<typeof UncertaintyItemSchema>

/** Uncertainty block: explicit uncertainties when data is incomplete. */
const UncertaintyBlockSchema = z.object({
  items: z.array(UncertaintyItemSchema),
  /** Optional summary for AI. */
  summaryForAI: z.string().optional(),
})
export type UncertaintyBlock = z.infer<typeof UncertaintyBlockSchema>

/** Single missing-data entry: not silently ignored. */
const MissingDataItemSchema = z.object({
  /** What is missing (e.g. "Market valuation for Player X"). */
  what: z.string(),
  /** Impact: high | medium | low. */
  impact: z.enum(['high', 'medium', 'low']),
  /** Optional suggestion (e.g. "Add player to roster to get valuation"). */
  suggestedAction: z.string().optional(),
})
export type MissingDataItem = z.infer<typeof MissingDataItemSchema>

/** Missing-data block: must be surfaced to AI and optionally to user. */
const MissingDataBlockSchema = z.object({
  items: z.array(MissingDataItemSchema),
  summaryForAI: z.string().optional(),
})
export type MissingDataBlock = z.infer<typeof MissingDataBlockSchema>

/**
 * Deterministic context envelope — the single schema passed into every AI tool
 * that requires factual grounding. All facts come from here; AI must not invent.
 */
export const DeterministicContextEnvelopeSchema = z.object({
  /** Tool this envelope is for. */
  toolId: z.string(),
  /** Sport (NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER). */
  sport: z.string().refine((sport) => isSupportedSport(sport), {
    message: 'Unsupported sport. Use NFL, NHL, NBA, MLB, NCAAB, NCAAF, or SOCCER.',
  }),
  /** League id when in league context. */
  leagueId: z.string().nullable().optional(),
  /** User id when known. */
  userId: z.string().nullable().optional(),
  /** Structured facts from deterministic engines only. */
  evidence: EvidenceBlockSchema.optional(),
  /** Confidence from deterministic layer; AI must not override. */
  confidence: ConfidenceSchema.optional(),
  /** Explicit uncertainties when data is incomplete. */
  uncertainty: UncertaintyBlockSchema.optional(),
  /** Missing data; must be passed to AI and surfaced when confidence is capped. */
  missingData: MissingDataBlockSchema.optional(),
  /** Raw payload for backward compatibility (e.g. trade context object). */
  deterministicPayload: z.record(z.string(), z.unknown()).nullable().optional(),
  /** Hard constraints for AI (e.g. "Do not override fairnessScore"). */
  hardConstraints: z.array(z.string()).optional(),
  /** Optional envelope id for tracing. */
  envelopeId: z.string().optional(),
  /** Data quality summary for debug/trace. */
  dataQualitySummary: z.string().optional(),
})
export type DeterministicContextEnvelope = z.infer<typeof DeterministicContextEnvelopeSchema>

/** Normalized AI tool output: same shape for every tool. */
export const NormalizedToolOutputSchema = z.object({
  /** Primary answer or verdict text. */
  primaryAnswer: z.string(),
  /** Verdict or one-line recommendation. */
  verdict: z.string().optional(),
  /** Evidence items to display; must come from envelope or be derived from deterministic payload. */
  evidence: z.array(EvidenceItemSchema).optional(),
  /** Legacy keyEvidence strings for backward compatibility. */
  keyEvidence: z.array(z.string()).optional(),
  /** Confidence; must reflect envelope and uncertainty. */
  confidence: ConfidenceSchema.optional(),
  /** Uncertainties to show when confidence is limited. */
  uncertainty: z.array(UncertaintyItemSchema).optional(),
  /** Missing data to show (never silently ignored). */
  missingData: z.array(MissingDataItemSchema).optional(),
  /** Caveats when confidence is capped or risks apply. */
  caveats: z.array(z.string()).optional(),
  /** Suggested next action. */
  suggestedNextAction: z.string().optional(),
  /** Alternate path. */
  alternatePath: z.string().optional(),
  /** Optional trace for admin/debug. */
  trace: z
    .object({
      envelopeId: z.string().optional(),
      toolId: z.string().optional(),
      dataQualitySummary: z.string().optional(),
      providerUsed: z.string().optional(),
    })
    .optional(),
})
export type NormalizedToolOutput = z.infer<typeof NormalizedToolOutputSchema>
