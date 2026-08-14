import { describe, expect, it } from 'vitest'

import { resolveProfileLabels } from '@/lib/psychological-profiles/ProfileLabelResolver'
import {
  EVIDENCE_FLOORS,
  evaluateDimension,
  summarizeEvidence,
} from '@/lib/psychological-profiles/ProfileEvidenceFloor'

const signals = (over: Record<string, number> = {}) =>
  ({
    managerId: 'm',
    leagueId: 'L',
    sport: 'NFL',
    tradeCount: 0,
    tradeFrequencyNorm: 0,
    tradeTimingLateRate: 0,
    waiverClaimCount: 0,
    waiverFocusNorm: 0,
    lineupChangeRate: 0,
    benchingPatternScore: 0,
    rookieAcquisitionRate: 0,
    vetAcquisitionRate: 0,
    draftPickCount: 0,
    draftEarlyRoundRate: 0,
    positionPriorityConcentration: 0,
    picksTradedAway: 0,
    picksAcquired: 0,
    rebuildScore: 0,
    contentionScore: 0,
    aggressionNorm: 0,
    riskNorm: 0,
    ...over,
  }) as never

describe('a manager we have never observed gets no personality', () => {
  it('emits no labels at all', () => {
    // Before the gate this returned ["conservative", "quiet strategist"]: every
    // threshold for the quiet archetypes is an upper bound, so emptiness passed
    // all of them. That is a character judgement about a real person, invented
    // from absence, and under the asymmetric display model it could be shown to
    // their leaguemate as intel.
    expect(resolveProfileLabels(signals())).toEqual([])
  })

  it('says what is missing instead of guessing', () => {
    const summary = summarizeEvidence(signals())
    expect(summary.anySufficient).toBe(false)
    expect(summary.overallConfidence).toBeNull()
    expect(summary.missingDimensions.sort()).toEqual(['draft', 'roster', 'trade'])
    expect(summary.dimensions.trade.shortfall).toContain('No trade activity recorded yet')
  })

  it('names the count when there is some activity but not enough', () => {
    const d = evaluateDimension('trade', signals({ tradeCount: 1 }))
    expect(d.sufficient).toBe(false)
    expect(d.shortfall).toContain('1 trade action')
    expect(d.shortfall).toContain(String(EVIDENCE_FLOORS.trade.min))
  })
})

describe('dimensions are gated independently', () => {
  it('gives a draft profile and withholds trade when only drafts exist', () => {
    // The real shape of a dynasty league mid-life: hundreds of picks, few trades.
    const labels = resolveProfileLabels(signals({ draftPickCount: 35, rookieAcquisitionRate: 62 }))
    expect(labels).toEqual(['rookie-heavy'])

    const summary = summarizeEvidence(signals({ draftPickCount: 35, rookieAcquisitionRate: 62 }))
    expect(summary.observedDimensions).toEqual(['draft'])
    expect(summary.missingDimensions.sort()).toEqual(['roster', 'trade'])
  })

  it('counts picks moved as trade evidence, not just trade rows', () => {
    // In dynasty the clearest trade behaviour is often pick movement.
    const d = evaluateDimension('trade', signals({ tradeCount: 0, picksTradedAway: 2, picksAcquired: 2 }))
    expect(d.evidenceCount).toBe(4)
    expect(d.sufficient).toBe(true)
  })
})

describe('earned labels survive the gate', () => {
  it('still calls a genuinely quiet but ACTIVE manager conservative', () => {
    // The fix must be a gate, not a lobotomy: a manager who really did trade
    // sparingly and claim cautiously has demonstrated the trait.
    const labels = resolveProfileLabels(
      signals({
        tradeCount: 2,
        picksTradedAway: 2,
        picksAcquired: 1,
        waiverClaimCount: 6,
        riskNorm: 20,
        aggressionNorm: 15,
      }),
    )
    expect(labels).toContain('conservative')
    expect(labels).toContain('quiet strategist')
  })

  it('scales confidence with how much was actually observed', () => {
    expect(evaluateDimension('trade', signals({ tradeCount: 3 })).confidence).toBe('low')
    expect(evaluateDimension('trade', signals({ tradeCount: 6 })).confidence).toBe('moderate')
    expect(evaluateDimension('trade', signals({ tradeCount: 12 })).confidence).toBe('high')
  })

  it('does not call a manager well known on one dimension alone', () => {
    // 40+ picks is high confidence in DRAFT, but knowing how someone drafts is
    // not knowing the manager.
    const summary = summarizeEvidence(signals({ draftPickCount: 60 }))
    expect(summary.dimensions.draft.confidence).toBe('high')
    expect(summary.overallConfidence).toBe('moderate')
  })
})
