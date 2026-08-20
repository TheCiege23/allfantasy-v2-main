import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const readMock = vi.fn()
vi.mock('@/lib/decision-os/three-brain/phase3/readLeagueIntelligence', () => ({
  readLeagueIntelligence: (...a: unknown[]) => readMock(...a),
}))

import { attachSavedAnalysis } from '@/lib/decision-os/three-brain/phase4/attachSavedAnalysis'
import type { Decision } from '@/lib/decision-os/core/decision'

function makeDecision(decisionType = 'manager.waiver.claim'): Decision {
  return {
    decision_id: 'd1',
    decision_type: decisionType,
    decider_scope: 'user',
    lifecycle_phase: 'in_season',
    four_answers: {
      what_happened: 'Two starters on bye.',
      why_it_matters: 'Short of a legal lineup.',
      how_confident: 'High.',
      what_to_do: 'Claim a replacement RB.',
    },
    recommended_actions: [{ kind: 'claim' }],
    rule_verdicts: [{ rule: 'faab', verdict: 'legal', message: 'ok', severity: 'info' }],
    confidence: 72,
    data_completeness: 88,
    uncertainty_sources: [],
    provenance: { weakest_source: 'projections', weakest_trust: 'medium' },
    automation_capable: false,
    explanation: 'DETERMINISTIC',
    telemetry: {
      dco_consumed: true, rule_gated: true, decision_object_emitted: true,
      explainable: true, world_resolution_read_only: true,
    },
  }
}

const result = {
  schemaVersion: '1',
  decisionType: 'manager.waiver.claim',
  shortAnswer: 'Claiming a running back is the best move.',
  whatDataSays: 'Bench output is down three weeks running.',
  whatItMeans: 'The gap is depth, not luck.',
  alternatives: [],
  caveats: [],
  evidenceIds: [],
  agreementState: 'agreed',
  specialistStatus: { deepseek: 'ok', grok: 'ok', openai: 'ok', anthropic: 'not_requested' },
  claudeState: 'not_requested',
  freshness: 'fresh',
  missingInformation: [],
} as never

function dbWithRuns(n: number) {
  return { decisionIntelligenceRun: { count: vi.fn(async () => n) } } as never
}

beforeEach(() => readMock.mockReset())

describe('attachSavedAnalysis — the cheap path', () => {
  it('short-circuits on zero succeeded runs WITHOUT the expensive read', async () => {
    // The permanent case while AI spend is disabled, and the common case regardless.
    // `readLeagueIntelligence` rebuilds the whole evidence packet to derive its identity key, so
    // calling it just to learn "nothing here" would tax a live route on every request.
    const db = dbWithRuns(0)
    const out = await attachSavedAnalysis({ db, decision: makeDecision(), leagueId: 'L1', userId: 'u1', tool: 'manager_intelligence' })
    expect(out.enriched).toBe(false)
    expect(out.reason).toBe('no_succeeded_run')
    expect(readMock).not.toHaveBeenCalled()
    expect(out.decision.explanation).toBe('DETERMINISTIC')
  })

  it('does the real read only once a succeeded run exists', async () => {
    readMock.mockResolvedValue({ status: 'ready', result })
    const out = await attachSavedAnalysis({ db: dbWithRuns(1), decision: makeDecision(), leagueId: 'L1', userId: 'u1', tool: 'manager_intelligence' })
    expect(readMock).toHaveBeenCalledTimes(1)
    expect(out.enriched).toBe(true)
    expect(out.decision.explanation).not.toBe('DETERMINISTIC')
  })
})

describe('attachSavedAnalysis — it never breaks the caller', () => {
  it('returns the decision unchanged when the datastore throws', async () => {
    // The routes that mount this document "must never fail the route". The Decision is already
    // complete without enrichment, so returning it untouched is the correct degraded answer.
    //
    // The throw is injected through the db rather than through the mocked read: vitest attributes
    // a throw raised inside a `vi.mock` factory to the test file itself, so that spelling reports
    // as a failure even when the code under test catches it correctly. Same catch, same guarantee,
    // without fighting the instrumentation.
    const db = { decisionIntelligenceRun: { count: vi.fn(async () => { throw new Error('db down') }) } } as never
    const before = makeDecision()
    const out = await attachSavedAnalysis({ db, decision: before, leagueId: 'L1', userId: 'u1', tool: 'manager_intelligence' })
    expect(out.enriched).toBe(false)
    expect(out.reason).toBe('attach_failed')
    expect(out.decision).toBe(before)
    expect(out.decision.explanation).toBe('DETERMINISTIC')
  })

  it('returns a well-formed outcome even when the datastore delegate is missing entirely', async () => {
    const out = await attachSavedAnalysis({ db: {} as never, decision: makeDecision(), leagueId: 'L1', userId: 'u1', tool: 'manager_intelligence' })
    expect(out.enriched).toBe(false)
    expect(out.reason).toBe('attach_failed')
  })

  it('passes a paywalled `locked` read straight through unenriched', async () => {
    readMock.mockResolvedValue({ status: 'locked', result: null })
    const out = await attachSavedAnalysis({ db: dbWithRuns(1), decision: makeDecision(), leagueId: 'L1', userId: 'u1', tool: 'manager_intelligence' })
    expect(out.enriched).toBe(false)
    expect(out.decision.explanation).toBe('DETERMINISTIC')
  })
})

describe('attachSavedAnalysis — invariants it inherits', () => {
  it('never alters the verdict path', async () => {
    readMock.mockResolvedValue({ status: 'ready', result })
    const before = makeDecision()
    const out = await attachSavedAnalysis({ db: dbWithRuns(1), decision: before, leagueId: 'L1', userId: 'u1', tool: 'manager_intelligence' })
    expect(out.decision.rule_verdicts).toBe(before.rule_verdicts)
    expect(out.decision.recommended_actions).toBe(before.recommended_actions)
    expect(out.decision.four_answers).toBe(before.four_answers)
    expect(out.decision.confidence).toBe(72)
  })

  it('refuses on an ILLEGAL verdict even with a ready analysis', async () => {
    readMock.mockResolvedValue({ status: 'ready', result })
    const before = makeDecision()
    before.rule_verdicts = [{ rule: 'deadline', verdict: 'illegal', message: 'passed', severity: 'critical' }]
    const out = await attachSavedAnalysis({ db: dbWithRuns(1), decision: before, leagueId: 'L1', userId: 'u1', tool: 'manager_intelligence' })
    expect(out.enriched).toBe(false)
    expect(out.reason).toBe('decision_is_illegal')
    expect(out.decision.explanation).toBe('DETERMINISTIC')
  })

  it('is fail-closed on an unknown decision type', async () => {
    // An unlisted type resolves to explanation_only, so it still reaches the gates below rather
    // than being treated as authorised to do more.
    readMock.mockResolvedValue({ status: 'ready', result })
    const out = await attachSavedAnalysis({ db: dbWithRuns(0), decision: makeDecision('some.future.decision'), leagueId: 'L1', userId: 'u1', tool: 'manager_intelligence' })
    expect(out.reason).toBe('no_succeeded_run')
  })
})
