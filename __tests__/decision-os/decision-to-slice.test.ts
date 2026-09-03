import { describe, it, expect } from 'vitest'
import { decisionToSlice, type DecisionFact } from '@/lib/decision-os/grounding/decisionToSlice'
import type { Decision, RuleVerdict } from '@/lib/decision-os/core/decision'
import type { GroundingGap } from '@/lib/decision-os/grounding/packet'

/**
 * ── R2.1 — the bridge from Pipeline A (live engines) into the grounding packet ──────────────
 *
 * The two pipelines share no code: four decision engines are live in production and users see
 * them, while the grounding packet is what Chimmy reads. This adapter is the read-only seam.
 * These tests pin the decisions that are easy to get subtly wrong and impossible to notice.
 */

const GAP: GroundingGap = {
  reason: 'not_requested',
  detail: 'the caller did not ask for a lineup decision',
  remedy: 'ask for one',
}

function makeDecision(over: Partial<Decision<{ player: string }>> = {}): Decision<{ player: string }> {
  return {
    decision_id: 'd1',
    decision_type: 'manager.lineup.set',
    decider_scope: 'user',
    lifecycle_phase: 'in_week',
    four_answers: {
      what_happened: 'Two starters are on bye.',
      why_it_matters: 'You would field ten players.',
      how_confident: 'High — the schedule is authoritative.',
      what_to_do: 'Start Smith and Jones.',
    },
    recommended_actions: [{ player: 'Smith' }, { player: 'Jones' }],
    rule_verdicts: [],
    confidence: 82,
    data_completeness: 95,
    uncertainty_sources: [],
    provenance: { weakest_source: 'sleeper_roster', weakest_trust: 'high' },
    automation_capable: true,
    explanation: 'Two byes leave gaps at RB and WR.',
    telemetry: {
      dco_consumed: true,
      rule_gated: true,
      decision_object_emitted: true,
      explainable: true,
      world_resolution_read_only: true,
    },
    ...over,
  }
}

describe('R2.1 — Decision -> GroundedSlice', () => {
  it('carries the four contract answers through to the fact', () => {
    const s = decisionToSlice(makeDecision(), GAP)
    expect(s.present).toBe(true)
    const v = s.value as DecisionFact
    expect(v.whatHappened).toBe('Two starters are on bye.')
    expect(v.whyItMatters).toBe('You would field ten players.')
    expect(v.howConfident).toMatch(/High/)
    expect(v.whatToDo).toBe('Start Smith and Jones.')
    expect(v.decisionType).toBe('manager.lineup.set')
  })

  it('🛑 an ILLEGAL rule verdict does NOT make the decision inconclusive', () => {
    // This is the one most likely to be "fixed" into a bug. An illegal verdict is the most
    // conclusive thing a decision can say — "your league's rules forbid this" is a finding, not a
    // gap. Blocking on it would suppress exactly the answer the user most needs.
    const illegal: RuleVerdict[] = [
      { rule: 'roster_max', verdict: 'illegal', message: 'Roster would exceed 16', severity: 'critical' },
    ]
    const s = decisionToSlice(makeDecision({ rule_verdicts: illegal }), GAP)
    expect(s.present).toBe(true)
    expect(s.conclusive.ok).toBe(true)
    const v = s.value as DecisionFact
    expect(v.legal).toBe(false)
    expect(v.verdicts).toHaveLength(1)
  })

  it('low data_completeness DOES block — the inputs, never the content', () => {
    const s = decisionToSlice(
      makeDecision({ data_completeness: 40, uncertainty_sources: ['roster incomplete', 'no projections'] }),
      GAP,
    )
    expect(s.present).toBe(true)
    expect(s.conclusive.ok).toBe(false)
    if (s.conclusive.ok === false) {
      expect(s.conclusive.blockedBy[0].assertion).toBe('coverage')
      expect(s.conclusive.blockedBy[0].detail).toMatch(/40%/)
      expect(s.conclusive.blockedBy[0].remedy).not.toHaveLength(0)
    }
  })

  it('a weak-trust weakest_source blocks and NAMES the source', () => {
    const s = decisionToSlice(
      makeDecision({ provenance: { weakest_source: 'manual_entry', weakest_trust: 'unverified' } }),
      GAP,
    )
    expect(s.conclusive.ok).toBe(false)
    if (s.conclusive.ok === false) {
      expect(s.conclusive.blockedBy.some((b) => b.detail.includes('manual_entry'))).toBe(true)
    }
  })

  it('an absent decision returns the caller-supplied gap, never an error', () => {
    const s = decisionToSlice(null, GAP)
    expect(s.present).toBe(false)
    expect(s.value).toBeNull()
    expect(s.gap).toEqual(GAP)
  })

  it('🛑 a decision missing a contract answer degrades to a gap rather than THROWING', () => {
    // assertFourAnswers throws by design. We deliberately do not call it: one malformed decision
    // must not take down the packet build for every other slice in the same turn.
    const bad = makeDecision()
    bad.four_answers.what_to_do = '   '
    expect(() => decisionToSlice(bad, GAP)).not.toThrow()
    const s = decisionToSlice(bad, GAP)
    expect(s.present).toBe(false)
    expect(s.gap?.reason).toBe('not_computed')
    expect(s.gap?.detail).toMatch(/four required answers/i)
  })

  it('counts actions ALWAYS, and describes them only when given a describer', () => {
    // Without a describer, "2 actions, not described" is true. A best-effort stringifier on an
    // unknown shape yields "[object Object]" and puts it in a prompt as though it were a fact.
    const bare = decisionToSlice(makeDecision(), GAP)
    expect((bare.value as DecisionFact).actionCount).toBe(2)
    expect((bare.value as DecisionFact).actionSummary).toEqual([])

    const described = decisionToSlice(makeDecision(), GAP, { describeAction: (x) => `start ${x.player}` })
    expect((described.value as DecisionFact).actionSummary).toEqual(['start Smith', 'start Jones'])
  })

  it('caps described actions at 8 while still reporting the true count', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ player: `P${i}` }))
    const s = decisionToSlice(makeDecision({ recommended_actions: many }), GAP, {
      describeAction: (x) => x.player,
    })
    const v = s.value as DecisionFact
    expect(v.actionSummary).toHaveLength(8)
    expect(v.actionCount).toBe(30) // the count must not be capped — that would understate the work
  })

  it('⚠ rescales confidence 0-100 to the slice’s 0..1, and marks it served live', () => {
    const s = decisionToSlice(makeDecision({ confidence: 82 }), GAP)
    expect(s.confidence).toBeCloseTo(0.82, 5)
    // A bridged decision is computed for this request, not served warm from the feed store.
    expect(s.servedFrom).toBe('live')
  })

  it('does not invent an asOf — null unless the caller knows one', () => {
    // "now" as a stand-in would make a decision look freshly grounded when its inputs may be old.
    expect(decisionToSlice(makeDecision(), GAP).asOf).toBeNull()
    expect(decisionToSlice(makeDecision(), GAP, { asOf: '2026-09-03T00:00:00Z' }).asOf).toBe('2026-09-03T00:00:00Z')
  })
})
