/**
 * Deterministic agreement + confidence. The models may express uncertainty in prose, but the SERVER assigns
 * the displayed `agreementState` and `confidencePct` from observable factors (specialist availability,
 * detected disagreement, evidence completeness/freshness, dropped over-claims). Confidence is bounded and
 * never 100 — thinner evidence or fewer providers always lowers it.
 */
import type {
  AgreementState,
  ClaudeReviewVerdict,
  DecisionOSEvidencePacket,
  SpecialistEvaluation,
} from './types'

/**
 * Opposing directive pairs → deterministic disagreement detection between the two specialists. Covers the
 * decision surfaces this service must reason about: start/sit (lineup), accept/decline (trade),
 * add/drop (waiver), buy/sell + hold/trade (trade value), and intervene/do-not-intervene (commissioner).
 */
const OPPOSING_PAIRS: Array<[RegExp, RegExp]> = [
  [/\bstart\b/i, /\b(sit|bench)\b/i],
  [/\baccept\b/i, /\b(decline|reject|veto)\b/i],
  [/\b(add|claim|pick up|pickup)\b/i, /\b(drop|cut|waive)\b/i],
  [/\bbuy\b/i, /\bsell\b/i],
  [/\b(hold|keep|stand pat)\b/i, /\b(trade|move|deal)\b/i],
  [/\bintervene\b/i, /\b(do not intervene|don'?t intervene|no intervention|leave it|no action|stand down)\b/i],
]

/** An explicit action/directive from a specialist. */
const ACTION_RE =
  /\b(start|sit|bench|accept|decline|reject|veto|add|claim|drop|cut|waive|buy|sell|trade|hold|keep|intervene|activate|pick up|pickup|recommend)\b/i
/** Pure risk/caution language (a warning, not a directive). */
const RISK_WARN_RE =
  /\b(risk|risky|caution|cautious|warning|warn|concern|danger|dangerous|downside|red flag|injur|questionable|volatile|avoid|beware|unsafe)\b/i
/** An explicit "we can't/shouldn't decide yet" position. */
const INSUFFICIENT_RE =
  /\b(insufficient|not enough|cannot recommend|can'?t recommend|no clear|unclear|too little|lack of data|inconclusive|need more|no recommendation|hold off)\b/i

function specialistText(e: SpecialistEvaluation): string {
  return [e.recommendation ?? '', ...e.findings.map((f) => f.claim), ...e.caveats].join(' ')
}

/** A specialist "contributed" if it returned a schema-valid response (completed OR degraded). */
function contributed(e: SpecialistEvaluation): boolean {
  return e.status !== 'failed'
}

/** Symmetric "A matches x while B matches y" helper. */
function crossMatch(a: string, b: string, x: RegExp, y: RegExp): boolean {
  return (x.test(a) && y.test(b)) || (y.test(a) && x.test(b))
}

/** One specialist is a PURE warning (risk, no directive) while the other recommends an action. */
function detectRiskVsAction(a: string, b: string): boolean {
  const riskSide = (t: string) => RISK_WARN_RE.test(t) && !ACTION_RE.test(t)
  return (riskSide(a) && ACTION_RE.test(b)) || (riskSide(b) && ACTION_RE.test(a))
}

/** One specialist says the evidence is insufficient while the other gives a directive. */
function detectInsufficientVsDirective(a: string, b: string): boolean {
  const holdSide = (t: string) => INSUFFICIENT_RE.test(t)
  return (
    (holdSide(a) && ACTION_RE.test(b) && !INSUFFICIENT_RE.test(b)) ||
    (holdSide(b) && ACTION_RE.test(a) && !INSUFFICIENT_RE.test(a))
  )
}

export function detectDisagreement(deepseek: SpecialistEvaluation, grok: SpecialistEvaluation): boolean {
  const a = specialistText(deepseek)
  const b = specialistText(grok)
  for (const [x, y] of OPPOSING_PAIRS) {
    if (crossMatch(a, b, x, y)) return true
  }
  return detectRiskVsAction(a, b) || detectInsufficientVsDirective(a, b)
}

/**
 * Material minority warnings that MUST survive OpenAI + Claude processing: high-impact risk findings and any
 * risk-worded caveat from either specialist. The orchestrator unions these into the final caveats so a
 * downstream model can never quietly drop a safety warning. De-duplicated case-insensitively.
 */
export function collectMinorityWarnings(deepseek: SpecialistEvaluation, grok: SpecialistEvaluation): string[] {
  const out: string[] = []
  for (const e of [deepseek, grok]) {
    for (const f of e.findings) if (f.impact === 'high' && RISK_WARN_RE.test(f.claim)) out.push(f.claim)
    for (const c of e.caveats) if (RISK_WARN_RE.test(c)) out.push(c)
  }
  return dedupeCaveats(out)
}

/** Case-insensitive de-dup that preserves first-seen order. */
function dedupeCaveats(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of items) {
    const s = raw.trim()
    if (!s) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

/** Merge caveats, appending any `extra` not already present (case-insensitive). */
export function mergeCaveats(base: string[], extra: string[]): string[] {
  return dedupeCaveats([...base, ...extra])
}

/**
 * Adjust server confidence for a Claude review verdict. Claude may LOWER confidence but NEVER raise it:
 *  - approved / unavailable → unchanged (a passing review is not evidence for MORE confidence).
 *  - qualified → a modest penalty (the synthesis needed grounded corrections).
 *  - rejected → capped low (the synthesis is materially unsound); paired with a disagreement state upstream.
 * Always clamped to the same [5,92] band and never above the pre-review value.
 */
export function adjustConfidenceForReview(
  confidencePct: number | undefined,
  verdict: ClaudeReviewVerdict,
): number | undefined {
  if (confidencePct == null) return confidencePct
  if (verdict === 'rejected') return Math.max(5, Math.min(confidencePct, 40))
  if (verdict === 'qualified') return Math.max(5, confidencePct - 8)
  return confidencePct // approved / unavailable — never raised
}

export function computeAgreementState(
  deepseek: SpecialistEvaluation,
  grok: SpecialistEvaluation,
  openaiOk: boolean,
): AgreementState {
  const dOk = contributed(deepseek)
  const gOk = contributed(grok)
  if (!dOk && !gOk) return 'deterministic_only' // both specialists failed → no synthesis happened
  if (!openaiOk) return 'degraded' // synthesis failed
  if (dOk !== gOk) return 'degraded' // exactly one specialist down
  if (detectDisagreement(deepseek, grok)) return 'disagreement'
  const bothSubstantive = deepseek.findings.length > 0 && grok.findings.length > 0
  return bothSubstantive ? 'consensus' : 'partial_consensus'
}

const BASE_BY_STATE: Record<AgreementState, number> = {
  consensus: 75,
  partial_consensus: 60,
  disagreement: 45,
  degraded: 42,
  deterministic_only: 0,
}

/** Deterministic, bounded confidence. Returns undefined for deterministic_only (no three-brain confidence). */
export function computeConfidence(input: {
  packet: DecisionOSEvidencePacket
  deepseek: SpecialistEvaluation
  grok: SpecialistEvaluation
  agreementState: AgreementState
  droppedClaims: number
}): number | undefined {
  const { packet, deepseek, grok, agreementState, droppedClaims } = input
  if (agreementState === 'deterministic_only') return undefined

  let c = BASE_BY_STATE[agreementState]

  // Evidence completeness
  const evidenceCount = packet.deterministicSignals.length + packet.relevantFacts.length
  if (evidenceCount === 0) c -= 25
  else if (evidenceCount < 3) c -= 12

  // Missing information (each item lowers, capped)
  c -= Math.min(15, packet.missingInformation.length * 5)

  // Freshness
  if (packet.freshness.state === 'stale') c = Math.min(c, 50)
  else if (packet.freshness.state === 'aging') c -= 8
  else if (packet.freshness.state === 'unknown') c -= 5

  // Specialist availability / quality
  if (deepseek.status === 'failed') c -= 15
  else if (deepseek.status === 'degraded') c -= 6
  if (grok.status === 'failed') c -= 15
  else if (grok.status === 'degraded') c -= 6

  // Over-claimed / removed content
  c -= Math.min(10, droppedClaims * 3)

  // Clamp: never 100 (honest uncertainty), never below 5.
  return Math.max(5, Math.min(92, Math.round(c)))
}
