import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  enrichDecisionExplanation,
  assertVerdictPathUntouched,
  mentionsModel,
} from '@/lib/decision-os/three-brain/phase4/explanationEnrichment'
import type { Decision, RuleVerdict } from '@/lib/decision-os/core/decision'
import type { ThreeBrainDecisionResult } from '@/lib/decision-os/three-brain/types'

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    decision_id: 'd1',
    decision_type: 'manager.waiver.claim',
    decider_scope: 'user',
    lifecycle_phase: 'in_season',
    four_answers: {
      what_happened: 'Two starters are on bye.',
      why_it_matters: 'You are two bodies short of a legal lineup.',
      how_confident: 'High — roster and bye weeks are authoritative.',
      what_to_do: 'Claim a replacement RB before Sunday.',
    },
    recommended_actions: [{ kind: 'claim', playerId: 'p1' }],
    rule_verdicts: [{ rule: 'faab.budget', verdict: 'legal', message: 'ok', severity: 'info' }],
    confidence: 72,
    data_completeness: 88,
    uncertainty_sources: ['projection variance'],
    provenance: { weakest_source: 'projections', weakest_trust: 'medium' },
    automation_capable: false,
    explanation: 'DETERMINISTIC EXPLANATION',
    telemetry: {
      dco_consumed: true,
      rule_gated: true,
      decision_object_emitted: true,
      explainable: true,
      world_resolution_read_only: true,
    },
    ...overrides,
  }
}

function makeResult(overrides: Partial<ThreeBrainDecisionResult> = {}): ThreeBrainDecisionResult {
  return {
    schemaVersion: '1',
    decisionType: 'manager.waiver.claim',
    shortAnswer: 'Claiming a running back is the highest-value move this week.',
    whatDataSays: 'Your bench has produced under eight points in three straight weeks.',
    whatItMeans: 'The gap is depth, not luck.',
    recommendedAction: 'Spend 14% of FAAB.',
    alternatives: ['Stand pat'],
    caveats: ['Waiver order resets Wednesday'],
    evidenceIds: ['sig-activity'],
    agreementState: 'agreed' as ThreeBrainDecisionResult['agreementState'],
    specialistStatus: { deepseek: 'ok', grok: 'ok', openai: 'ok', anthropic: 'not_requested' },
    claudeState: 'not_requested' as ThreeBrainDecisionResult['claudeState'],
    freshness: 'fresh' as ThreeBrainDecisionResult['freshness'],
    missingInformation: [],
    ...overrides,
  }
}

describe('AI explanation enrichment — the verdict path', () => {
  it('replaces the explanation and NOTHING else', () => {
    const before = makeDecision()
    const out = enrichDecisionExplanation({ decision: before, result: makeResult(), status: 'ready' })
    expect(out.enriched).toBe(true)
    if (!out.enriched) return
    expect(out.decision.explanation).not.toBe(before.explanation)
    // Every verdict-path field must be the SAME OBJECT, not an equal copy.
    expect(out.decision.rule_verdicts).toBe(before.rule_verdicts)
    expect(out.decision.recommended_actions).toBe(before.recommended_actions)
    expect(out.decision.four_answers).toBe(before.four_answers)
    expect(out.decision.provenance).toBe(before.provenance)
    expect(out.decision.confidence).toBe(72)
    expect(out.decision.data_completeness).toBe(88)
    expect(out.decision.automation_capable).toBe(false)
  })

  it("never lets the model's confidencePct become the Decision's confidence", () => {
    const before = makeDecision({ confidence: 72 })
    const out = enrichDecisionExplanation({
      decision: before,
      result: makeResult({ confidencePct: 99 }),
      status: 'ready',
    })
    expect(out.enriched).toBe(true)
    expect(out.decision.confidence).toBe(72)
  })

  it("never lets the model's recommendedAction reach recommended_actions", () => {
    const before = makeDecision()
    const out = enrichDecisionExplanation({
      decision: before,
      result: makeResult({ recommendedAction: 'Trade your whole bench.' }),
      status: 'ready',
    })
    expect(out.enriched).toBe(true)
    expect(out.decision.recommended_actions).toEqual([{ kind: 'claim', playerId: 'p1' }])
    expect(JSON.stringify(out.decision.recommended_actions)).not.toContain('Trade your whole bench')
    // ...and it must not smuggle it in through the prose either.
    expect(out.decision.explanation).not.toContain('Trade your whole bench')
  })

  it('assertVerdictPathUntouched THROWS when the verdict path is altered', () => {
    const before = makeDecision()
    const tampered: Decision = { ...before, confidence: 100 }
    expect(() => assertVerdictPathUntouched(before, tampered)).toThrow(/invariant violated/i)
    const reverdicted: Decision = {
      ...before,
      rule_verdicts: [...before.rule_verdicts] as RuleVerdict[],
    }
    expect(() => assertVerdictPathUntouched(before, reverdicted)).toThrow(/invariant violated/i)
  })
})

describe('AI explanation enrichment — refusals', () => {
  it('refuses when a rule returned illegal, keeping the deterministic explanation', () => {
    const before = makeDecision({
      rule_verdicts: [
        { rule: 'trade.deadline', verdict: 'illegal', message: 'Deadline passed', severity: 'critical' },
      ],
    })
    const out = enrichDecisionExplanation({ decision: before, result: makeResult(), status: 'ready' })
    expect(out.enriched).toBe(false)
    if (out.enriched) return
    expect(out.reason).toBe('decision_is_illegal')
    expect(out.decision.explanation).toBe('DETERMINISTIC EXPLANATION')
  })

  it.each(['generating', 'not_generated', 'evidence_unavailable', 'failed', 'unsupported_scope'] as const)(
    'refuses on status %s',
    (status) => {
      const out = enrichDecisionExplanation({ decision: makeDecision(), result: makeResult(), status })
      expect(out.enriched).toBe(false)
      if (!out.enriched) expect(out.reason).toBe('analysis_not_ready')
    },
  )

  it('refuses when there is no analysis at all', () => {
    const out = enrichDecisionExplanation({ decision: makeDecision(), result: null, status: 'ready' })
    expect(out.enriched).toBe(false)
    if (!out.enriched) expect(out.reason).toBe('no_analysis')
  })

  it('refuses when the analysis answers a different decision type', () => {
    const out = enrichDecisionExplanation({
      decision: makeDecision({ decision_type: 'manager.trade.evaluate' }),
      result: makeResult({ decisionType: 'manager.waiver.claim' }),
      status: 'ready',
    })
    expect(out.enriched).toBe(false)
    if (!out.enriched) expect(out.reason).toBe('decision_type_mismatch')
  })

  it('refuses — rather than scrubbing — when prose names a provider', () => {
    for (const leak of ['Claude suggests holding.', 'The GPT analysis favours a claim.', 'DeepSeek disagreed.']) {
      const out = enrichDecisionExplanation({
        decision: makeDecision(),
        result: makeResult({ shortAnswer: leak }),
        status: 'ready',
      })
      expect(out.enriched).toBe(false)
      if (!out.enriched) expect(out.reason).toBe('model_name_leak')
    }
  })

  it('refuses when the narrative is empty', () => {
    const out = enrichDecisionExplanation({
      decision: makeDecision(),
      result: makeResult({ shortAnswer: '  ', whatDataSays: '', whatItMeans: '   ' }),
      status: 'ready',
    })
    expect(out.enriched).toBe(false)
    if (!out.enriched) expect(out.reason).toBe('empty_narrative')
  })
})

describe('AI explanation enrichment — honesty of the narrative', () => {
  it('marks a stale analysis in the text so it cannot read as current', () => {
    const out = enrichDecisionExplanation({ decision: makeDecision(), result: makeResult(), status: 'stale' })
    expect(out.enriched).toBe(true)
    if (!out.enriched) return
    expect(out.stale).toBe(true)
    expect(out.decision.explanation).toMatch(/last completed analysis/i)
  })

  it('carries caveats and missing information into the explanation', () => {
    const out = enrichDecisionExplanation({
      decision: makeDecision(),
      result: makeResult({ caveats: ['Waiver order resets'], missingInformation: ['no injury report'] }),
      status: 'ready',
    })
    expect(out.enriched).toBe(true)
    if (!out.enriched) return
    expect(out.decision.explanation).toMatch(/Waiver order resets/)
    expect(out.decision.explanation).toMatch(/no injury report/)
  })

  it('says so in plain language when the specialists disagreed, naming no provider', () => {
    const out = enrichDecisionExplanation({
      decision: makeDecision(),
      result: makeResult({ agreementState: 'disagreement' as ThreeBrainDecisionResult['agreementState'] }),
      status: 'ready',
    })
    expect(out.enriched).toBe(true)
    if (!out.enriched) return
    expect(out.decision.explanation).toMatch(/disagreed/i)
    expect(mentionsModel(out.decision.explanation)).toBe(false)
  })

  it('mentionsModel positive control — it really does detect provider names', () => {
    expect(mentionsModel('anthropic')).toBe(true)
    expect(mentionsModel('an ordinary sentence about running backs')).toBe(false)
  })
})

describe('AI explanation enrichment — architecture invariants', () => {
  const SRC = path.join(
    process.cwd(),
    'lib/decision-os/three-brain/phase4/explanationEnrichment.ts',
  )

  /** Comments legitimately discuss `server-only` and the verdict-path field names, so scan CODE only —
   *  a substring test over the whole file fails on its own documentation. */
  function code(): string {
    return fs
      .readFileSync(SRC, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
  }

  it('is PURE — imports no prisma, no server-only, and performs no DB calls', () => {
    const src = code()
    expect(/from '@\/lib\/prisma'/.test(src)).toBe(false)
    expect(/import ['"]server-only['"]/.test(src)).toBe(false)
    expect(/\.(findMany|findFirst|findUnique|create|update|upsert|delete)\(/.test(src)).toBe(false)
  })

  it('routes every enriched Decision through the runtime verdict-path guard', () => {
    const src = code()
    // The guard is the real protection (behaviourally covered above); this stops a future edit
    // from constructing an enriched Decision and returning it without re-checking.
    expect(src).toMatch(/assertVerdictPathUntouched\(decision, enriched\)/)
    // `enriched: true;` also appears in the type union — count only the RETURN form (comma).
    const enrichedReturns = src.match(/enriched:\s*true,/g) ?? []
    expect(enrichedReturns.length).toBe(1)
  })

  it('builds the enriched Decision by spreading the original, overriding only explanation', () => {
    const src = code()
    const start = src.indexOf('const enriched:')
    expect(start).toBeGreaterThan(-1)
    // Search for the guard AFTER the literal — the symbol also appears earlier as its own export.
    const literal = src.slice(start, src.indexOf('assertVerdictPathUntouched', start))
    expect(literal).toContain('...decision')
    // Inside that literal, `explanation` must be the sole overridden key.
    const keys = [...literal.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1])
    expect(keys).toEqual(['explanation'])
  })
})
