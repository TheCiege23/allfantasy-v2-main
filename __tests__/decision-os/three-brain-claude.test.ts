/**
 * Decision OS three-brain — Phase 1.5: Claude (Anthropic) as a SELECTIVE reviewer + synthesis fallback.
 *
 * Exercises the REAL production orchestrator with the provider boundary mocked (no real paid calls). Proves:
 *  - Claude is invoked ONLY when a deterministic condition holds (disagreement / low confidence / policy),
 *    never on every request, and at most once.
 *  - As reviewer, Claude receives the evidence + both specialist evals + the candidate synthesis + the
 *    server-owned agreement/confidence/freshness (read-only), and cannot set authoritative fields, invent
 *    evidence, or emit URLs.
 *  - Verdicts drive the final result honestly (approve preserves; qualify corrects; reject withholds
 *    consensus). Claude can lower confidence, never raise it.
 *  - When OpenAI fails, Claude may produce a fallback synthesis; both-fail degrades.
 *  - Deterministic disagreement covers lineup/trade/waiver/commissioner/insufficient-evidence/risk-vs-action,
 *    and material minority warnings survive downstream processing.
 *  - Timeouts pass an AbortSignal (cancellation where supported); a late completion never mutates the result;
 *    a timeout never triggers a duplicate fallback.
 */
import { describe, it, expect, vi } from 'vitest'
import { runThreeBrainAnalysis } from '@/lib/decision-os/three-brain/orchestrator'
import type { ThreeBrainProviderGetter } from '@/lib/decision-os/three-brain/orchestrator'
import type { ThreeBrainChatOptions } from '@/lib/decision-os/three-brain/providerClient'
import { buildEvidencePacket } from '@/lib/decision-os/three-brain/evidencePacket'
import {
  detectDisagreement,
  collectMinorityWarnings,
  adjustConfidenceForReview,
} from '@/lib/decision-os/three-brain/confidence'
import {
  evaluateClaudeReviewEligibility,
  shouldRunClaudeFallback,
  DEFAULT_CLAUDE_CONFIDENCE_THRESHOLD,
} from '@/lib/decision-os/three-brain/eligibility'
import type { ProviderChatRequest, ProviderChatResult } from '@/lib/ai-orchestration/types'
import type { SpecialistEvaluation } from '@/lib/decision-os/three-brain/types'

const noopUsage = async () => {}

function okJson(json: unknown, model = 'mock-model'): ProviderChatResult {
  return { text: JSON.stringify(json), json, model, provider: 'openai', status: 'ok', tokensPrompt: 10, tokensCompletion: 5 }
}
const timeoutRes = (): ProviderChatResult => ({ text: '', model: 'mock', provider: 'openai', status: 'timeout', timedOut: true })
const malformedRes = (): ProviderChatResult => ({ text: 'not json {{{', model: 'mock', provider: 'openai', status: 'ok' })

type Handler = (req: ProviderChatRequest, opts?: ThreeBrainChatOptions) => ProviderChatResult | Promise<ProviderChatResult>
function makeProviders(handlers: { deepseek?: Handler; grok?: Handler; openai?: Handler; anthropic?: Handler }) {
  const mk = (h: Handler) => vi.fn((req: ProviderChatRequest, opts?: ThreeBrainChatOptions) => Promise.resolve(h(req, opts)))
  const spies = {
    deepseek: mk(handlers.deepseek ?? (() => okJson({ findings: [], caveats: [] }))),
    grok: mk(handlers.grok ?? (() => okJson({ findings: [], caveats: [] }))),
    openai: mk(handlers.openai ?? (() => okJson({ shortAnswer: 'default', alternatives: [], caveats: [], evidenceIds: [] }))),
    anthropic: mk(handlers.anthropic ?? (() => okJson({ verdict: 'approved', findings: [], requiredCaveats: [] }))),
  }
  const getProvider: ThreeBrainProviderGetter = (role) => ({
    chat: spies[role as keyof typeof spies],
    isAvailable: () => true,
  })
  return { getProvider, spies }
}

function packet(over: Partial<Parameters<typeof buildEvidencePacket>[0]> = {}) {
  return buildEvidencePacket({
    userId: 'user-1',
    sport: 'NFL',
    decisionType: 'start_sit',
    mode: 'league',
    canonicalLeagueId: 'league-1',
    signals: [{ id: 'sig-1', kind: 'lineup_gap', summary: 'FLEX slot empty' }],
    facts: [{ id: 'fact-1', label: 'Projection A', value: '14.2' }],
    freshness: { state: 'fresh', providerUpdatedAt: '2026-07-28T12:00:00.000Z', ingestedAt: '2026-07-28T12:05:00.000Z' },
    requestId: 'req-1',
    generatedAt: '2026-07-28T12:06:00.000Z',
    ...over,
  })
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
const userMsg = (spy: ReturnType<typeof vi.fn>) => (spy.mock.calls[0][0] as ProviderChatRequest).messages[1].content
const sysMsg = (spy: ReturnType<typeof vi.fn>) => (spy.mock.calls[0][0] as ProviderChatRequest).messages[0].content

// A confident-consensus scenario (both specialists agree, adequate evidence) → NOT review-eligible unless a
// caller policy asks for it. Distinctive claim text so we can assert what Claude receives.
const consensusHandlers = {
  deepseek: () => okJson({ findings: [{ claim: 'DQUANT_CLAIM', evidenceIds: ['sig-1'], impact: 'low' as const }], recommendation: 'start', caveats: [] }),
  grok: () => okJson({ findings: [{ claim: 'GTREND_CLAIM', evidenceIds: ['fact-1'], impact: 'low' as const }], recommendation: 'start', caveats: [] }),
  openai: () => okJson({ shortAnswer: 'OPENAI_SYNTH', whatDataSays: 'wds', whatItMeans: 'wim', recommendedAction: 'start', alternatives: [], caveats: ['base caveat'], evidenceIds: ['sig-1'] }),
}
// A disagreement scenario (start vs sit) → review-eligible with no policy.
const disagreementHandlers = {
  deepseek: () => okJson({ findings: [{ claim: 'start him', evidenceIds: ['sig-1'], impact: 'high' as const }], recommendation: 'start', caveats: [] }),
  grok: () => okJson({ findings: [{ claim: 'sit him', evidenceIds: ['sig-1'], impact: 'high' as const }], recommendation: 'sit', caveats: [] }),
  openai: () => okJson({ shortAnswer: 'MIXED', alternatives: [], caveats: [], evidenceIds: ['sig-1'] }),
}

// ── Selective invocation ──────────────────────────────────────────────────────────────────────────────
describe('selective invocation — Claude does not run on every request', () => {
  it('confident consensus with no policy → Claude NOT requested (not premium by default)', async () => {
    const { getProvider, spies } = makeProviders({ ...consensusHandlers })
    const r = await runThreeBrainAnalysis(packet(), { getProvider, recordUsage: noopUsage })
    expect(spies.anthropic).not.toHaveBeenCalled()
    expect(r.claudeState).toBe('not_requested')
    expect(r.reviewVerdict).toBeUndefined()
    expect(r.specialistStatus.anthropic).toBe('not_requested')
    expect(r.shortAnswer).toBe('OPENAI_SYNTH')
  })

  it('specialist disagreement → Claude review runs (once)', async () => {
    const { getProvider, spies } = makeProviders({ ...disagreementHandlers })
    const r = await runThreeBrainAnalysis(packet(), { getProvider, recordUsage: noopUsage })
    expect(spies.anthropic).toHaveBeenCalledTimes(1)
    expect(r.claudeState).toBe('completed')
    expect(r.reviewVerdict).toBe('approved')
  })

  it('low server confidence → Claude review runs even without disagreement', async () => {
    const { getProvider, spies } = makeProviders({}) // empty specialist findings + thin/stale evidence → low conf
    const p = packet({ signals: [], facts: [], missingInformation: ['no projections', 'no injuries'], freshness: { state: 'stale' } })
    const r = await runThreeBrainAnalysis(p, { getProvider, recordUsage: noopUsage })
    expect(r.confidencePct!).toBeLessThanOrEqual(DEFAULT_CLAUDE_CONFIDENCE_THRESHOLD)
    expect(spies.anthropic).toHaveBeenCalledTimes(1)
    expect(r.claudeState).toBe('completed')
  })

  it('caller policy explicitReviewRequested → Claude review runs on an otherwise-ineligible consensus', async () => {
    const { getProvider, spies } = makeProviders({ ...consensusHandlers })
    await runThreeBrainAnalysis(packet(), { getProvider, recordUsage: noopUsage, reviewPolicy: { explicitReviewRequested: true } })
    expect(spies.anthropic).toHaveBeenCalledTimes(1)
    expect(sysMsg(spies.anthropic)).toContain('INDEPENDENT REVIEWER')
  })

  it('caller policy highStakesPremium → Claude review runs', async () => {
    const { getProvider, spies } = makeProviders({ ...consensusHandlers })
    await runThreeBrainAnalysis(packet(), { getProvider, recordUsage: noopUsage, reviewPolicy: { highStakesPremium: true } })
    expect(spies.anthropic).toHaveBeenCalledTimes(1)
  })

  it('Claude runs AT MOST ONCE across an eligible review run', async () => {
    const { getProvider, spies } = makeProviders({ ...disagreementHandlers })
    await runThreeBrainAnalysis(packet(), { getProvider, recordUsage: noopUsage })
    expect(spies.anthropic).toHaveBeenCalledTimes(1)
  })
})

// ── Deterministic eligibility policy (unit) ───────────────────────────────────────────────────────────
describe('deterministic eligibility policy', () => {
  it('disagreement OR confidence≤threshold OR explicit OR premium → eligible; confident consensus → not', () => {
    expect(evaluateClaudeReviewEligibility({ agreementState: 'disagreement', confidencePct: 70 }).eligible).toBe(true)
    expect(evaluateClaudeReviewEligibility({ agreementState: 'consensus', confidencePct: 40 }).triggers).toContain('low_confidence')
    expect(evaluateClaudeReviewEligibility({ agreementState: 'consensus', confidencePct: 80, policy: { explicitReviewRequested: true } }).eligible).toBe(true)
    expect(evaluateClaudeReviewEligibility({ agreementState: 'consensus', confidencePct: 80, policy: { highStakesPremium: true } }).eligible).toBe(true)
    // Standalone default: confident consensus, no policy → NOT eligible.
    expect(evaluateClaudeReviewEligibility({ agreementState: 'consensus', confidencePct: 80 }).eligible).toBe(false)
  })

  it('confidence threshold is overridable by policy', () => {
    expect(evaluateClaudeReviewEligibility({ agreementState: 'consensus', confidencePct: 60, policy: { confidenceThreshold: 65 } }).eligible).toBe(true)
    expect(evaluateClaudeReviewEligibility({ agreementState: 'consensus', confidencePct: 60, policy: { confidenceThreshold: 50 } }).eligible).toBe(false)
  })

  it('fallback eligibility requires usable specialist or evidence material', () => {
    const good: SpecialistEvaluation = { provider: 'deepseek', status: 'completed', findings: [], caveats: [] }
    const dead: SpecialistEvaluation = { provider: 'grok', status: 'failed', findings: [], caveats: [] }
    expect(shouldRunClaudeFallback({ packet: packet(), deepseek: good, grok: dead })).toBe(true)
    expect(shouldRunClaudeFallback({ packet: packet({ signals: [], facts: [] }), deepseek: dead, grok: dead })).toBe(false)
  })
})

// ── Review role — what Claude receives + cannot do ────────────────────────────────────────────────────
describe('review role — evidence + both evals + candidate synthesis + read-only server context', () => {
  it('review request carries the evidence, both specialist evals, the candidate synthesis, and server context', async () => {
    const { getProvider, spies } = makeProviders({ ...consensusHandlers })
    await runThreeBrainAnalysis(packet(), { getProvider, recordUsage: noopUsage, reviewPolicy: { explicitReviewRequested: true } })
    const msg = userMsg(spies.anthropic)
    expect(msg).toContain('DQUANT_CLAIM')
    expect(msg).toContain('GTREND_CLAIM')
    expect(msg).toContain('OPENAI_SYNTH')
    expect(msg).toContain('<candidate_synthesis>')
    expect(msg).toContain('<server_context')
    expect(msg).toContain('agreementState')
  })

  it('Claude review cannot set authoritative fields (confidence/freshness) — schema strips them', async () => {
    const { getProvider } = makeProviders({
      ...consensusHandlers,
      anthropic: () => okJson({ verdict: 'qualified', findings: [], requiredCaveats: [], confidencePct: 100, freshness: { state: 'fresh' }, agreementState: 'consensus' }),
    })
    const p = packet({ freshness: { state: 'stale', providerUpdatedAt: '2026-01-01T00:00:00.000Z' } })
    const r = await runThreeBrainAnalysis(p, { getProvider, recordUsage: noopUsage, reviewPolicy: { highStakesPremium: true } })
    expect(r.confidencePct).not.toBe(100)
    expect(r.freshness.state).toBe('stale')
    expect(r.freshness.providerUpdatedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('a review finding citing UNKNOWN evidence is dropped; a pure critique (no evidence id) is kept', async () => {
    const { getProvider } = makeProviders({
      ...consensusHandlers,
      anthropic: () => okJson({
        verdict: 'rejected',
        findings: [
          { claim: 'CITES_GHOST', evidenceIds: ['GHOST'], impact: 'high' },
          { claim: 'PURE_CRITIQUE_no_evidence', evidenceIds: [], impact: 'high' },
        ],
        requiredCaveats: [],
      }),
    })
    const r = await runThreeBrainAnalysis(packet(), { getProvider, recordUsage: noopUsage, reviewPolicy: { explicitReviewRequested: true } })
    // rejected surfaces surviving findings as caveats.
    expect(r.caveats.join(' ')).toContain('PURE_CRITIQUE_no_evidence')
    expect(r.caveats.join(' ')).not.toContain('CITES_GHOST')
    expect(r.specialistStatus.anthropic).toBe('degraded') // a drop occurred
  })

  it('URLs in Claude output are stripped', async () => {
    const { getProvider } = makeProviders({
      ...consensusHandlers,
      anthropic: () => okJson({ verdict: 'rejected', findings: [{ claim: 'visit https://evil.example/steal now', evidenceIds: [], impact: 'high' }], requiredCaveats: ['see www.phish.test'] }),
    })
    const r = await runThreeBrainAnalysis(packet(), { getProvider, recordUsage: noopUsage, reviewPolicy: { explicitReviewRequested: true } })
    const joined = r.caveats.join(' ')
    expect(joined).not.toContain('evil.example')
    expect(joined).not.toContain('phish.test')
    expect(joined).toContain('[link removed]')
  })
})

// ── Verdict → final result behavior ───────────────────────────────────────────────────────────────────
describe('verdict → final result behavior', () => {
  async function baselineConfidence() {
    const { getProvider } = makeProviders({ ...consensusHandlers })
    const r = await runThreeBrainAnalysis(packet(), { getProvider, recordUsage: noopUsage })
    return r.confidencePct!
  }

  it('approved → preserves the OpenAI synthesis and does NOT raise confidence', async () => {
    const base = await baselineConfidence()
    const { getProvider } = makeProviders({ ...consensusHandlers, anthropic: () => okJson({ verdict: 'approved', findings: [], requiredCaveats: ['always check inactives'] }) })
    const r = await runThreeBrainAnalysis(packet(), { getProvider, recordUsage: noopUsage, reviewPolicy: { explicitReviewRequested: true } })
    expect(r.shortAnswer).toBe('OPENAI_SYNTH')
    expect(r.reviewVerdict).toBe('approved')
    expect(r.claudeState).toBe('completed')
    expect(r.confidencePct).toBe(base) // never raised
    expect(r.caveats).toContain('always check inactives')
  })

  it('qualified → applies only grounded corrections, preserves required caveats, LOWERS confidence', async () => {
    const base = await baselineConfidence()
    const { getProvider } = makeProviders({
      ...consensusHandlers,
      anthropic: () => okJson({ verdict: 'qualified', findings: [{ claim: 'projection is optimistic', evidenceIds: ['fact-1'], impact: 'medium' }], requiredCaveats: ['weather risk noted'], correctedContent: { shortAnswer: 'CORRECTED_ANSWER' } }),
    })
    const r = await runThreeBrainAnalysis(packet(), { getProvider, recordUsage: noopUsage, reviewPolicy: { explicitReviewRequested: true } })
    expect(r.shortAnswer).toBe('CORRECTED_ANSWER')
    expect(r.reviewVerdict).toBe('qualified')
    expect(r.caveats).toContain('weather risk noted')
    expect(r.confidencePct!).toBeLessThan(base)
  })

  it('rejected → no false consensus: disagreement state, concerns disclosed, confidence lowered', async () => {
    const base = await baselineConfidence()
    const { getProvider } = makeProviders({
      ...consensusHandlers,
      anthropic: () => okJson({ verdict: 'rejected', findings: [{ claim: 'synthesis ignores the bye week', evidenceIds: [], impact: 'high' }], requiredCaveats: ['do not start on bye'] }),
    })
    const r = await runThreeBrainAnalysis(packet(), { getProvider, recordUsage: noopUsage, reviewPolicy: { explicitReviewRequested: true } })
    expect(r.agreementState).toBe('disagreement')
    expect(r.reviewVerdict).toBe('rejected')
    expect(r.shortAnswer.toLowerCase()).toContain('unresolved')
    expect(r.caveats.join(' ')).toContain('bye week')
    expect(r.confidencePct!).toBeLessThan(base)
    expect(r.confidencePct!).toBeLessThanOrEqual(40)
  })

  it('adjustConfidenceForReview never raises and clamps by verdict', () => {
    expect(adjustConfidenceForReview(70, 'approved')).toBe(70)
    expect(adjustConfidenceForReview(70, 'qualified')).toBe(62)
    expect(adjustConfidenceForReview(70, 'rejected')).toBe(40)
    expect(adjustConfidenceForReview(undefined, 'rejected')).toBeUndefined()
  })

  it('Claude failure after a valid OpenAI synthesis → preserve OpenAI, disclose review unavailable', async () => {
    const { getProvider } = makeProviders({ ...consensusHandlers, anthropic: () => malformedRes() })
    const r = await runThreeBrainAnalysis(packet(), { getProvider, recordUsage: noopUsage, reviewPolicy: { explicitReviewRequested: true } })
    expect(r.shortAnswer).toBe('OPENAI_SYNTH') // OpenAI preserved
    expect(r.claudeState).toBe('failed')
    expect(r.reviewVerdict).toBe('unavailable')
    expect(r.specialistStatus.anthropic).toBe('failed')
    expect(r.caveats.join(' ')).toContain('review was unavailable')
  })
})

// ── Fallback synthesis (OpenAI unavailable) ───────────────────────────────────────────────────────────
describe('fallback synthesis when OpenAI is unavailable', () => {
  it('OpenAI fails + material remains → Claude fallback synthesis (claudeState fallback_synthesis)', async () => {
    const { getProvider, spies } = makeProviders({
      deepseek: () => okJson({ findings: [{ claim: 'd', evidenceIds: ['sig-1'], impact: 'low' }], caveats: [] }),
      grok: () => okJson({ findings: [{ claim: 'g', evidenceIds: ['fact-1'], impact: 'low' }], caveats: [] }),
      openai: () => timeoutRes(),
      anthropic: () => okJson({ shortAnswer: 'FALLBACK_ANSWER', whatDataSays: '', whatItMeans: '', alternatives: [], caveats: [], evidenceIds: ['sig-1'] }),
    })
    const r = await runThreeBrainAnalysis(packet(), { getProvider, recordUsage: noopUsage })
    expect(spies.anthropic).toHaveBeenCalledTimes(1)
    expect(sysMsg(spies.anthropic)).toContain('FINAL SYNTHESIZER') // Claude synthesizes, not reviews
    expect(r.shortAnswer).toBe('FALLBACK_ANSWER')
    expect(r.claudeState).toBe('fallback_synthesis')
    expect(r.specialistStatus.openai).toBe('failed')
    expect(r.specialistStatus.anthropic).toBe('completed')
    expect(r.reviewVerdict).toBeUndefined()
    expect(r.caveats.join(' ')).toContain('OpenAI synthesis was unavailable')
  })

  it('OpenAI fails + Claude fallback also fails → degraded (no fabricated answer)', async () => {
    const { getProvider } = makeProviders({
      deepseek: () => okJson({ findings: [{ claim: 'd', evidenceIds: ['sig-1'], impact: 'low' }], caveats: [] }),
      grok: () => okJson({ findings: [{ claim: 'g', evidenceIds: ['sig-1'], impact: 'low' }], caveats: [] }),
      openai: () => timeoutRes(),
      anthropic: () => malformedRes(),
    })
    const r = await runThreeBrainAnalysis(packet(), { getProvider, recordUsage: noopUsage })
    expect(r.agreementState).toBe('degraded')
    expect(r.claudeState).toBe('failed')
    expect(r.shortAnswer).toContain('Synthesis unavailable')
    expect(r.recommendedAction).toBeUndefined()
  })

  it('the four Claude states are distinguishable', async () => {
    // not_requested (confident consensus)
    const a = await runThreeBrainAnalysis(packet(), { getProvider: makeProviders({ ...consensusHandlers }).getProvider, recordUsage: noopUsage })
    // completed (disagreement → review)
    const b = await runThreeBrainAnalysis(packet(), { getProvider: makeProviders({ ...disagreementHandlers }).getProvider, recordUsage: noopUsage })
    // fallback_synthesis (openai down, claude synthesizes)
    const c = await runThreeBrainAnalysis(packet(), { getProvider: makeProviders({ ...consensusHandlers, openai: () => timeoutRes(), anthropic: () => okJson({ shortAnswer: 'F', alternatives: [], caveats: [], evidenceIds: [] }) }).getProvider, recordUsage: noopUsage })
    // failed (eligible review, claude broken)
    const d = await runThreeBrainAnalysis(packet(), { getProvider: makeProviders({ ...disagreementHandlers, anthropic: () => malformedRes() }).getProvider, recordUsage: noopUsage })
    expect([a.claudeState, b.claudeState, c.claudeState, d.claudeState]).toEqual(['not_requested', 'completed', 'fallback_synthesis', 'failed'])
  })

  it('never labeled as a four-provider run when Claude did not run', async () => {
    const { getProvider } = makeProviders({ ...consensusHandlers })
    const r = await runThreeBrainAnalysis(packet(), { getProvider, recordUsage: noopUsage })
    expect(r.claudeState).toBe('not_requested')
    expect(r.specialistStatus.anthropic).not.toBe('completed')
  })
})

// ── Disagreement coverage (deterministic, beyond start/sit) ───────────────────────────────────────────
describe('deterministic disagreement coverage', () => {
  const ev = (recommendation: string | undefined, claims: string[] = [], caveats: string[] = []): SpecialistEvaluation => ({
    provider: 'deepseek',
    status: 'completed',
    findings: claims.map((c) => ({ claim: c, evidenceIds: ['sig-1'], impact: 'medium' as const })),
    recommendation,
    caveats,
  })

  it('lineup start vs sit', () => {
    expect(detectDisagreement(ev('start the flex'), ev('sit the flex'))).toBe(true)
  })
  it('trade accept vs decline', () => {
    expect(detectDisagreement(ev('accept the trade'), ev('decline the trade'))).toBe(true)
  })
  it('waiver add vs drop', () => {
    expect(detectDisagreement(ev('add the streamer'), ev('drop nobody, cut the streamer'))).toBe(true)
  })
  it('commissioner intervene vs do-not-intervene', () => {
    expect(detectDisagreement(ev('intervene and reverse it'), ev('do not intervene, leave it'))).toBe(true)
  })
  it('insufficient-evidence vs directive', () => {
    expect(detectDisagreement(ev(undefined, ['insufficient data to decide']), ev('start him'))).toBe(true)
  })
  it('one warns risk while the other recommends action', () => {
    expect(detectDisagreement(ev(undefined, [], ['significant injury risk, be cautious']), ev('start him'))).toBe(true)
  })
  it('does NOT flag agreement (both start) or a single nuanced rec', () => {
    expect(detectDisagreement(ev('start him'), ev('start him'))).toBe(false)
    // one specialist that both recommends AND notes a risk is not a disagreement by itself
    expect(detectDisagreement(ev('start him', [], ['slight risk']), ev('start him'))).toBe(false)
  })
})

// ── Minority-warning survival ─────────────────────────────────────────────────────────────────────────
describe('material minority warnings survive processing', () => {
  it('a high-impact risk finding survives into the final caveats even if OpenAI omitted it', async () => {
    const { getProvider } = makeProviders({
      deepseek: () => okJson({ findings: [{ claim: 'major injury risk to the RB1', evidenceIds: ['sig-1'], impact: 'high' }], recommendation: 'start', caveats: [] }),
      grok: () => okJson({ findings: [{ claim: 'trending up', evidenceIds: ['fact-1'], impact: 'low' }], recommendation: 'start', caveats: [] }),
      openai: () => okJson({ shortAnswer: 'start', alternatives: [], caveats: [], evidenceIds: ['sig-1'] }), // omits the warning
    })
    const r = await runThreeBrainAnalysis(packet(), { getProvider, recordUsage: noopUsage })
    expect(r.claudeState).toBe('not_requested') // confident consensus, no Claude
    expect(r.caveats.join(' ').toLowerCase()).toContain('injury risk')
  })

  it('collectMinorityWarnings unit — high-impact risk finding + risk caveats', () => {
    const d: SpecialistEvaluation = { provider: 'deepseek', status: 'completed', findings: [{ claim: 'high injury risk', evidenceIds: ['sig-1'], impact: 'high' }], caveats: [] }
    const g: SpecialistEvaluation = { provider: 'grok', status: 'completed', findings: [], caveats: ['volatile matchup, caution advised'] }
    const warnings = collectMinorityWarnings(d, g)
    expect(warnings.some((w) => /injury risk/i.test(w))).toBe(true)
    expect(warnings.some((w) => /volatile/i.test(w))).toBe(true)
  })
})

// ── Timeout & cost safety ─────────────────────────────────────────────────────────────────────────────
describe('timeout & cost safety', () => {
  it('a timed-out Claude review is passed an AbortSignal that fires (cancellation where supported)', async () => {
    let captured: AbortSignal | undefined
    const hang: Handler = (_req, opts) => {
      captured = opts?.signal
      return new Promise<ProviderChatResult>(() => {}) // never resolves
    }
    const { getProvider, spies } = makeProviders({ ...disagreementHandlers, anthropic: hang })
    const r = await runThreeBrainAnalysis(packet(), { getProvider, recordUsage: noopUsage, perProviderTimeoutMs: 20 })
    expect(captured).toBeInstanceOf(AbortSignal)
    expect(captured!.aborted).toBe(true)
    expect(spies.anthropic).toHaveBeenCalledTimes(1) // no duplicate call
    expect(r.claudeState).toBe('failed')
    expect(r.reviewVerdict).toBe('unavailable')
    expect(r.shortAnswer).toBe('MIXED') // OpenAI synthesis preserved
  })

  it('a late Claude completion after timeout does not mutate the returned result', async () => {
    // Consensus + policy so the review is eligible but the base state is NOT already 'disagreement' — that
    // way a late 'rejected' completion trying to flip the state would be observable if it leaked through.
    const aDef = deferred<ProviderChatResult>()
    const { getProvider } = makeProviders({ ...consensusHandlers, anthropic: () => aDef.promise })
    const r = await runThreeBrainAnalysis(packet(), { getProvider, recordUsage: noopUsage, perProviderTimeoutMs: 20, reviewPolicy: { explicitReviewRequested: true } })
    expect(r.reviewVerdict).toBe('unavailable')
    expect(r.agreementState).toBe('consensus')
    // Resolve LATE with a rejecting verdict — must not change the already-returned result.
    aDef.resolve(okJson({ verdict: 'rejected', findings: [], requiredCaveats: ['too late'] }))
    await Promise.resolve()
    await Promise.resolve()
    expect(r.reviewVerdict).toBe('unavailable')
    expect(r.agreementState).toBe('consensus') // not flipped to 'disagreement' by the late reject
    expect(r.caveats.join(' ')).not.toContain('too late')
  })

  it('emits non-sensitive telemetry for the Claude stage (no prompts / payloads)', async () => {
    const usage = vi.fn(async (_arg: unknown) => {})
    const { getProvider } = makeProviders({ ...disagreementHandlers })
    await runThreeBrainAnalysis(packet(), { getProvider, recordUsage: usage })
    const tools = usage.mock.calls.map(([arg]) => (arg as { tool: string }).tool)
    expect(tools).toContain('three_brain_anthropic')
    for (const [arg] of usage.mock.calls) {
      expect(arg).not.toHaveProperty('prompt')
      expect(arg).not.toHaveProperty('messages')
    }
  })
})
