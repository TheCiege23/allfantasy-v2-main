/**
 * Claude REVIEW stage — prompt builder + server validation.
 *
 * When OpenAI's synthesis succeeds and Claude is eligible, Claude receives a MINIMIZED evidence packet, the
 * validated DeepSeek + Grok evaluations, the validated OpenAI synthesis, and the SERVER-owned agreement /
 * confidence / freshness (read-only context). It reviews for: unsupported claims, hidden/flattened
 * disagreement, misread evidence, dropped minority/safety warnings, overconfidence, missing caveats, and
 * internal contradiction.
 *
 * Trust boundary (same posture as the specialists, plus one deliberate difference):
 *  - Claude may cite ONLY evidence ids present in the packet; ids it invents are dropped.
 *  - A review finding that critiques an UNSUPPORTED synthesis claim legitimately cites NO evidence id — it
 *    points at an ABSENCE. We therefore keep a finding with zero evidence ids (a pure review observation),
 *    but DROP a finding that cited ids of which none are known (that asserted unknown evidence).
 *  - URLs are stripped; corrected content may carry only the 5 prose fields (the zod schema strips any
 *    attempt to set authoritative fields like confidence / freshness / agreement).
 *  - Claude never browses, fetches, invents facts, changes identity, decides access, assigns confidence, or
 *    overrides freshness. Those constraints are enforced here (validation) AND in the prompt.
 */
import type { ProviderChatRequest, ProviderChatResult } from '@/lib/ai-orchestration/types'
import { SAFETY_PREAMBLE, evidenceBlock, specialistBlock } from './prompts'
import { ClaudeReviewDraftSchema } from './schemas'
import { parseModelJson, sanitizeModelText } from './validate'
import type { SynthesisDraftValidated } from './validate'
import type {
  AgreementState,
  ClaudeReviewEvaluation,
  DecisionFreshness,
  DecisionOSEvidencePacket,
  SpecialistEvaluation,
  SpecialistFinding,
} from './types'

const REVIEW_OUTPUT_SPEC =
  'Return JSON of shape { "verdict": "approved"|"qualified"|"rejected", "findings": [ { "claim": string, "evidenceIds": string[], "impact": "low"|"medium"|"high" } ], "requiredCaveats": string[], "correctedContent"?: { "shortAnswer"?: string, "whatDataSays"?: string, "whatItMeans"?: string, "recommendedAction"?: string, "alternatives"?: string[] } }. Use "approved" if the synthesis is sound; "qualified" if it needs grounded corrections or added caveats (include only evidence-grounded corrections in correctedContent); "rejected" if it is materially wrong, fabricated, or hides a disagreement. A finding that flags an UNSUPPORTED synthesis claim may cite no evidence id; any evidence id you DO cite must appear in the packet. Do NOT output confidence, freshness, agreement, identities, or URLs — those are owned by the system.'

/**
 * Build the Claude review request. `serverContext` is passed as read-only data so Claude can see what the
 * server already decided WITHOUT being able to change it (it is not part of Claude's output schema).
 */
export function buildClaudeReviewRequest(input: {
  packet: DecisionOSEvidencePacket
  deepseek: SpecialistEvaluation
  grok: SpecialistEvaluation
  synthesis: SynthesisDraftValidated
  serverContext: { agreementState: AgreementState; confidencePct?: number; freshness: DecisionFreshness }
}): ProviderChatRequest {
  const { packet, deepseek, grok, synthesis, serverContext } = input
  const system = `${SAFETY_PREAMBLE} ROLE: You are the INDEPENDENT REVIEWER. You receive the verified evidence, two specialist evaluations, a candidate FINAL SYNTHESIS produced by another model, and the system's own agreement/confidence/freshness for context (READ-ONLY — you may not change them). Check the synthesis for: (1) claims unsupported by the evidence, (2) a disagreement between the specialists that the synthesis hid or flattened, (3) misread evidence, (4) a dropped minority or safety warning, (5) overconfident language, (6) missing necessary caveats, (7) internal contradiction. You do NOT browse, fetch, invent facts/players/numbers/URLs, change identities, decide access, assign confidence, or override freshness. Never raise confidence because another model ran. ${REVIEW_OUTPUT_SPEC}`
  const candidate = {
    shortAnswer: synthesis.shortAnswer,
    whatDataSays: synthesis.whatDataSays,
    whatItMeans: synthesis.whatItMeans,
    recommendedAction: synthesis.recommendedAction ?? null,
    alternatives: synthesis.alternatives,
    caveats: synthesis.caveats,
    evidenceIds: synthesis.evidenceIds,
  }
  const user = [
    `Review the candidate synthesis for this ${packet.decisionType} decision using only the evidence below.`,
    evidenceBlock(packet),
    'Specialist evaluations:',
    specialistBlock('deepseek', deepseek),
    specialistBlock('grok', grok),
    `<candidate_synthesis>${JSON.stringify(candidate)}</candidate_synthesis>`,
    `<server_context note="read-only; you may not change these">${JSON.stringify({
      agreementState: serverContext.agreementState,
      confidencePct: serverContext.confidencePct ?? null,
      freshness: serverContext.freshness,
    })}</server_context>`,
  ].join('\n')
  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    responseFormat: 'json_object',
    temperature: 0.2,
  }
}

export type ClaudeReviewValidation = {
  evaluation: ClaudeReviewEvaluation
  droppedUnknownEvidence: number
  droppedUnsupported: number
}

const reviewFailed = (): ClaudeReviewValidation => ({
  evaluation: { provider: 'anthropic', status: 'failed', verdict: 'unavailable', findings: [], requiredCaveats: [] },
  droppedUnknownEvidence: 0,
  droppedUnsupported: 0,
})

/** Validate + ground Claude's review output against the packet's evidence ids. */
export function validateClaudeReview(raw: ProviderChatResult, validIds: ReadonlySet<string>): ClaudeReviewValidation {
  if (raw.status !== 'ok') return reviewFailed()
  const parsed = ClaudeReviewDraftSchema.safeParse(parseModelJson(raw))
  if (!parsed.success) return reviewFailed()

  let droppedUnknownEvidence = 0
  let droppedUnsupported = 0
  const findings: SpecialistFinding[] = []
  for (const f of parsed.data.findings) {
    const claim = sanitizeModelText(f.claim)
    if (!claim) {
      droppedUnsupported += 1
      continue
    }
    const known = f.evidenceIds.filter((id) => validIds.has(id))
    droppedUnknownEvidence += f.evidenceIds.length - known.length
    // A review finding may cite NO evidence id (a critique of an absence). But if it cited ids and none are
    // known, it asserted unknown evidence → drop it.
    if (f.evidenceIds.length > 0 && known.length === 0) {
      droppedUnsupported += 1
      continue
    }
    findings.push({ claim, evidenceIds: known, impact: f.impact })
  }

  const requiredCaveats = parsed.data.requiredCaveats.map(sanitizeModelText).filter(Boolean)
  const cc = parsed.data.correctedContent
  const correctedContent = cc
    ? {
        shortAnswer: cc.shortAnswer ? sanitizeModelText(cc.shortAnswer) : undefined,
        whatDataSays: cc.whatDataSays ? sanitizeModelText(cc.whatDataSays) : undefined,
        whatItMeans: cc.whatItMeans ? sanitizeModelText(cc.whatItMeans) : undefined,
        recommendedAction: cc.recommendedAction ? sanitizeModelText(cc.recommendedAction) : undefined,
        alternatives: cc.alternatives?.map(sanitizeModelText).filter(Boolean),
      }
    : undefined

  const hadDrops = droppedUnsupported > 0 || droppedUnknownEvidence > 0
  return {
    evaluation: {
      provider: 'anthropic',
      status: hadDrops ? 'degraded' : 'completed',
      verdict: parsed.data.verdict,
      findings,
      requiredCaveats,
      correctedContent,
    },
    droppedUnknownEvidence,
    droppedUnsupported,
  }
}
