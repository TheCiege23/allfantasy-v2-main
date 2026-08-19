/**
 * Decision OS three-brain — server-owned contracts.
 *
 * The three models (DeepSeek analyst, Grok trend/context, OpenAI synthesizer) INTERPRET a verified evidence
 * packet; they are never the source of identity, access, entitlements, prices, freshness, sports status,
 * source URLs, confidence, or the evidence fingerprint. Every such field on these types is assigned by
 * deterministic server code (see confidence.ts / evidencePacket.ts). Models return only structured findings
 * that must cite evidence ids present in the packet.
 *
 * Phase 1 is a STANDALONE service — nothing here is wired into a live Decision OS route, persistence, or
 * token flow (those are later phases; see docs/decision-os/THREE_BRAIN_FOUNDATION.md).
 */

/** Bump only on a breaking shape change to the packet / result envelope. */
export const THREE_BRAIN_SCHEMA_VERSION = '1'

export type DecisionMode = 'global' | 'league'

/** Freshness of the evidence handed to the models. SERVER-OWNED — never set by a model. */
export type DecisionFreshness = {
  state: 'fresh' | 'aging' | 'stale' | 'unknown'
  /** Provider-observed update time (ISO), when known. Server value. */
  providerUpdatedAt?: string | null
  /** AllFantasy ingestion time (ISO), when known. Server value. */
  ingestedAt?: string | null
  ageSeconds?: number | null
}

/** A deterministic Decision OS signal supplied as evidence. Stable `id` so a model can cite it. */
export type DecisionOSSignal = {
  id: string
  /** Normalized signal kind (never display text), e.g. 'lineup_gap', 'trade_pending'. */
  kind: string
  /** Short deterministic summary of the signal (data, not an instruction). */
  summary: string
  severity?: 'info' | 'warning' | 'critical'
}

/** A verified fact supplied as evidence. Stable `id` so a model can cite it. */
export type VerifiedDecisionFact = {
  id: string
  label: string
  /** Stringified deterministic value. */
  value: string
  /** Provenance label (deterministic; never a URL). */
  source?: string
}

export type DecisionProviderStatus = {
  provider: string
  ok: boolean
  note?: string
}

/** The verified, minimized evidence supplied to the models. Assembled + owned by deterministic server code. */
export type DecisionOSEvidencePacket = {
  schemaVersion: string
  requestId: string
  userId: string
  canonicalLeagueId?: string
  platform?: string
  platformLeagueId?: string
  sport: string
  season?: string
  teamOrRosterId?: string
  userRole?: string
  mode: DecisionMode
  decisionType: string
  deterministicSignals: DecisionOSSignal[]
  relevantFacts: VerifiedDecisionFact[]
  freshness: DecisionFreshness
  providerStatus: DecisionProviderStatus[]
  missingInformation: string[]
  /** sha256 over the evidence (server value; models never set it). */
  evidenceFingerprint: string
  generatedAt: string
}

export type SpecialistProvider = 'deepseek' | 'grok'
/** completed = valid output; degraded = partial/over-claimed (some findings dropped); failed = no usable output. */
export type SpecialistStatus = 'completed' | 'degraded' | 'failed'

export type SpecialistFinding = {
  claim: string
  /** Must all be ids present in the packet — unknown ids are dropped by validation. */
  evidenceIds: string[]
  impact: 'low' | 'medium' | 'high'
}

export type SpecialistEvaluation = {
  provider: SpecialistProvider
  status: SpecialistStatus
  findings: SpecialistFinding[]
  recommendation?: string
  caveats: string[]
}

export type AgreementState =
  | 'consensus'
  | 'partial_consensus'
  | 'disagreement'
  | 'degraded'
  | 'deterministic_only'

/** The validated three-brain result. agreementState / confidence / freshness / specialistStatus / evidence
 *  identity are SERVER-owned; the model only drafts the explanatory prose. */
/** Claude (Anthropic) review verdict on the OpenAI synthesis. */
export type ClaudeReviewVerdict = 'approved' | 'qualified' | 'rejected' | 'unavailable'

/** State of the Claude stage in a run. `not_requested` = eligibility policy did not trigger it. */
export type ClaudeState = 'not_requested' | 'completed' | 'degraded' | 'failed' | 'fallback_synthesis'

/** Validated Claude review of the OpenAI synthesis (server-owned status; model owns only prose + verdict). */
export type ClaudeReviewEvaluation = {
  provider: 'anthropic'
  status: 'completed' | 'degraded' | 'failed' | 'not_requested'
  verdict: ClaudeReviewVerdict
  findings: SpecialistFinding[]
  requiredCaveats: string[]
  /** Evidence-grounded content corrections applied only on a `qualified` verdict (URLs stripped). */
  correctedContent?: {
    shortAnswer?: string
    whatDataSays?: string
    whatItMeans?: string
    recommendedAction?: string
    alternatives?: string[]
  }
}

export type ThreeBrainDecisionResult = {
  schemaVersion: string
  decisionType: string
  shortAnswer: string
  whatDataSays: string
  whatItMeans: string
  recommendedAction?: string
  alternatives: string[]
  caveats: string[]
  evidenceIds: string[]
  agreementState: AgreementState
  /** Per-provider status. `anthropic` reflects the Claude stage (see `claudeState`). */
  specialistStatus: { deepseek: string; grok: string; openai: string; anthropic: string }
  /** Distinguishes not_requested / completed / failed / fallback_synthesis for the Claude stage. */
  claudeState: ClaudeState
  /** Claude's review verdict when it ran as a reviewer (absent for fallback / not_requested). */
  reviewVerdict?: ClaudeReviewVerdict
  confidencePct?: number
  freshness: DecisionFreshness
  missingInformation: string[]
}
