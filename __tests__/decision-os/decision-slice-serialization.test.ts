import { describe, it, expect } from 'vitest'
import { serializeDecisionOsGroundingForPrompt } from '@/lib/decision-os/grounding/serialize'
import { decisionToSlice } from '@/lib/decision-os/grounding/decisionToSlice'
import type { Decision } from '@/lib/decision-os/core/decision'
import type { DecisionOsGroundingPacket, GroundedSlice, GroundingGap } from '@/lib/decision-os/grounding/packet'

/**
 * ── R2.2 — a bridged decision must REACH THE PROMPT, not be reduced to "available" ──────────
 *
 * 🛑 `renderValue` returns [] for anything that is not a string or an array, and a `DecisionFact`
 * is a plain object. So without an explicit branch a decision slice serialises to its header and
 * nothing else — which is G11, the exact bug this file was rewritten to fix for values, arriving
 * again through a new door. These tests exist so it cannot.
 */

const NOW = Date.parse('2026-09-03T00:00:00Z')

const GAP: GroundingGap = { reason: 'not_requested', detail: 'no decision asked for', remedy: 'ask' }

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
    data_completeness: 100,
    uncertainty_sources: [],
    provenance: { weakest_source: 'sleeper_roster', weakest_trust: 'high' },
    automation_capable: true,
    explanation: 'Two byes leave gaps.',
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

/** A packet carrying only what these tests read. Every other slice is deliberately absent. */
function packet(over: Partial<DecisionOsGroundingPacket> = {}): DecisionOsGroundingPacket {
  const absent = { present: false, value: null, asOf: null, servedFrom: null, confidence: null, conclusive: { ok: true }, gap: null } as unknown as GroundedSlice<unknown>
  return {
    importAssertions: absent,
    leagueRules: absent,
    marketValues: absent,
    devyValues: absent,
    projections: absent,
    commissionerIntelligence: absent,
    leagueIntelligence: absent,
    portfolio: absent,
    savedAnalysis: absent,
    managerPsychology: absent,
    gaps: [],
    meta: { sources: [], killedFeeds: [], buildMs: 1 },
    ...over,
  } as unknown as DecisionOsGroundingPacket
}

describe('R2.2 — decisions reach the prompt with their substance intact', () => {
  it('🛑 renders the four contract answers, NOT the word "available"', () => {
    const slice = decisionToSlice(makeDecision(), GAP, { describeAction: (a) => `start ${a.player}` })
    const text = serializeDecisionOsGroundingForPrompt(packet({ lineupDecision: slice }), NOW)
    expect(text).toContain('Two starters are on bye.')
    expect(text).toContain('You would field ten players.')
    expect(text).toContain('Start Smith and Jones.')
    // The G11 signature: a header with no substance beneath it.
    expect(text).not.toMatch(/Lineup decision: available\s*$/m)
  })

  it('🛑 an ILLEGAL verdict is rendered and is never dropped', () => {
    // A model that cannot see the rule verdict will cheerfully recommend a forbidden move.
    const slice = decisionToSlice(
      makeDecision({
        rule_verdicts: [{ rule: 'roster_max', verdict: 'illegal', message: 'Roster would exceed 16', severity: 'critical' }],
      }),
      GAP,
    )
    const text = serializeDecisionOsGroundingForPrompt(packet({ waiverDecision: slice }), NOW)
    expect(text).toContain('NOT ALLOWED')
    expect(text).toContain('roster_max')
    expect(text).toContain('Roster would exceed 16')
  })

  it('states the action COUNT even when the actions are not itemised', () => {
    // No describer supplied — the count is still true and must not read as "no actions".
    const slice = decisionToSlice(makeDecision(), GAP)
    const text = serializeDecisionOsGroundingForPrompt(packet({ lineupDecision: slice }), NOW)
    expect(text).toMatch(/2 recommended actions \(not itemised here\)/)
  })

  it('⚠ discloses weak inputs — a shaky decision must not read like a solid one', () => {
    const slice = decisionToSlice(
      makeDecision({ data_completeness: 45, provenance: { weakest_source: 'manual_entry', weakest_trust: 'unverified' } }),
      GAP,
    )
    const text = serializeDecisionOsGroundingForPrompt(packet({ commissionerHealthDecision: slice }), NOW)
    expect(text).toMatch(/45% of the inputs/)
    expect(text).toContain('manual_entry')
  })

  it('an absent decision slice adds no noise, and a missing one does not throw', () => {
    // Optional slices: a packet built before R2 has none of these fields at all.
    expect(() => serializeDecisionOsGroundingForPrompt(packet(), NOW)).not.toThrow()
    const text = serializeDecisionOsGroundingForPrompt(packet(), NOW)
    expect(text).not.toContain('Lineup decision')
  })
})
