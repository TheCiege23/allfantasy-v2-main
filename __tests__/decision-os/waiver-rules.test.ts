import { describe, it, expect } from 'vitest'
import {
  categorizeWaiverFailure,
  evaluateWaiverRules,
  evaluateWaiverRulesWithParity,
  type WaiverRuleContext,
} from '@/lib/decision-os/waiver/rules'
import type { RuleVerdict } from '@/lib/decision-os/core/decision'
import { fakeWorld } from './waiverFakes'

const ctx = (over: Partial<WaiverRuleContext> = {}): WaiverRuleContext => ({
  claim: { addPlayerId: 'wp1', dropPlayerId: null, faabBid: 14 },
  world: fakeWorld(),
  ...over,
})

describe('waiver rules — categorization of thrown gate messages', () => {
  it('maps known failure messages to normalized categories', () => {
    expect(categorizeWaiverFailure('Insufficient FAAB for this bid.')).toBe('insufficient_faab')
    expect(categorizeWaiverFailure('This starter is locked because their game has started.')).toBe('player_locked')
    expect(categorizeWaiverFailure('This player is on the commissioner undroppable list and cannot be dropped.')).toBe('undroppable')
    expect(categorizeWaiverFailure('You cannot add this player because your roster would be over the limit.')).toBe('roster_over_limit')
    expect(categorizeWaiverFailure('Weekly drop limit reached.')).toBe('drop_limit')
    expect(categorizeWaiverFailure('Waiver submissions are closed for this window.')).toBe('submission_window_closed')
    expect(categorizeWaiverFailure('Claim limit reached for this period.')).toBe('claim_limit_exceeded')
    expect(categorizeWaiverFailure('Waiver adds and edits are locked until the commissioner unlocks processing.')).toBe('processing_locked')
    expect(categorizeWaiverFailure('You must resolve IR, taxi, or devy slot issues first.')).toBe('roster_legality')
    expect(categorizeWaiverFailure('This player cannot be claimed via waivers.')).toBe('ineligible')
  })
})

describe('waiver Rule Framework — catches thrown eligibility and maps to verdicts', () => {
  it('legal when eligibility resolves (no throw)', async () => {
    const verdicts = await evaluateWaiverRules(ctx(), { assertEligibility: async () => undefined })
    expect(verdicts.every((v) => v.verdict !== 'illegal')).toBe(true)
  })

  it('a thrown FAAB error becomes an illegal verdict (active gate), never propagates', async () => {
    const verdicts = await evaluateWaiverRules(ctx(), {
      assertEligibility: async () => { throw new Error('Insufficient FAAB for this bid.') },
    })
    expect(verdicts.some((v) => v.rule === 'waiver.legality.insufficient_faab' && v.verdict === 'illegal')).toBe(true)
  })

  it('a closed submission window yields a temporarily_illegal verdict from the World', async () => {
    const verdicts = await evaluateWaiverRules(ctx({ world: fakeWorld({ processingLocked: true }) }), {
      assertEligibility: async () => undefined,
    })
    expect(verdicts.some((v) => v.verdict === 'temporarily_illegal')).toBe(true)
  })
})

describe('waiver validator parity — compose a second validator, never retire', () => {
  const canon = (...codes: string[]) => async (): Promise<RuleVerdict[]> =>
    codes.map((c) => ({ rule: `waiver.canonical.${c}`, verdict: 'illegal' as const, message: c, severity: 'critical' as const }))

  it('both agree on a shared category → agree on shared scope', async () => {
    const r = await evaluateWaiverRulesWithParity(ctx(), {
      assertEligibility: async () => { throw new Error('Insufficient FAAB for this bid.') },
      validateCanonical: canon('insufficient_faab'),
    })
    expect(r.parity.agreeOnSharedScope).toBe(true)
    expect(r.parity.sharedDisagreements).toEqual([])
  })

  it('complementary coverage (canonical-only category) → agree on shared, NOT retirement-safe', async () => {
    const r = await evaluateWaiverRulesWithParity(ctx(), {
      assertEligibility: async () => undefined,
      validateCanonical: canon('survivor_eliminated'),
    })
    expect(r.parity.agreeOnSharedScope).toBe(true)
    expect(r.parity.coverageDifferences).toContain('survivor_eliminated')
    expect(r.parity.reason).toBe('complementary_coverage')
    expect(r.retirementSafe).toBe(false)
  })

  it('survives a canonical validator that throws (active gate unaffected)', async () => {
    const r = await evaluateWaiverRulesWithParity(ctx(), {
      assertEligibility: async () => { throw new Error('Insufficient FAAB for this bid.') },
      validateCanonical: async () => { throw new Error('canonical boom') },
    })
    expect(r.canonicalVerdicts).toEqual([])
    expect(r.parity.reason).toBe('canonical_validator_error')
    expect(r.verdicts.some((v) => v.rule === 'waiver.legality.insufficient_faab')).toBe(true)
  })
})
