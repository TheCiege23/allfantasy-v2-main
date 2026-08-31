import { describe, expect, it } from 'vitest'
import { resolveProfileLabels, resolveScores } from '@/lib/psychological-profiles/ProfileLabelResolver'

describe('psychological profile label resolver', () => {
  it('assigns aggressive trade-focused labels for active high-risk managers', () => {
    const labels = resolveProfileLabels({
      managerId: 'm1',
      leagueId: 'l1',
      sport: 'NFL',
      tradeCount: 10,
      tradeFrequencyNorm: 75,
      /*
       * ⚠ `trade-heavy` STOPPED BEING AN ABSOLUTE JUDGEMENT AND THIS FIXTURE NEVER
       * CAUGHT UP. The rule now reads `tradeFrequencyRelative >= draftPeerDeviation`
       * (one full spread-width) rather than `tradeFrequencyNorm`, on the stated
       * reasoning that a fixed number is something a long-lived league clears by
       * simply existing. Absent from the fixture the field is undefined, every
       * comparison against it is false, and the label silently never fires.
       *
       * 1.6 is comfortably past the 1.0 threshold, which is what this manager —
       * ten trades, deliberately the busiest archetype in the file — is meant to be.
       */
      tradeFrequencyRelative: 1.6,
      tradeTimingLateRate: 65,
      waiverClaimCount: 16,
      waiverFocusNorm: 70,
      lineupChangeRate: 58,
      benchingPatternScore: 52,
      rookieAcquisitionRate: 62,
      vetAcquisitionRate: 22,
      /*
       * ⚠ 8 PICKS IS BELOW THE DRAFT EVIDENCE FLOOR, SO EVERY DRAFT-DIMENSION
       * LABEL WAS BEING GATED OUT — including `rookie-heavy`, which this case
       * asserts. ProfileEvidenceFloor requires draft: { min: 10 } counted as
       * `draftPickCount`, and the gate at the end of resolveProfileLabels drops
       * any label whose own dimension was not observed.
       *
       * The label rule itself never stopped matching (rookieAcquisitionRate 62 vs
       * a threshold of 55); the claim was refused for want of evidence, which is
       * the floor doing its job. Raised to 12 so this manager actually has a
       * draft to have an opinion about. Left just over the floor deliberately —
       * a number far above it would also mask a future raise of the floor.
       */
      draftPickCount: 12,
      draftEarlyRoundRate: 50,
      positionPriorityConcentration: 40,
      picksTradedAway: 6,
      picksAcquired: 2,
      rebuildScore: 10,
      contentionScore: 70,
      aggressionNorm: 72,
      riskNorm: 74,
    })
    expect(labels).toContain('trade-heavy')
    expect(labels).toContain('aggressive')
    expect(labels).toContain('waiver-focused')
    expect(labels).toContain('rookie-heavy')
    expect(labels).toContain('win-now')
  })

  it('computes bounded profile scores', () => {
    const scores = resolveScores({
      managerId: 'm2',
      leagueId: 'l1',
      sport: 'NBA',
      tradeCount: 1,
      tradeFrequencyNorm: 12,
      tradeTimingLateRate: 0,
      waiverClaimCount: 2,
      waiverFocusNorm: 9,
      lineupChangeRate: 18,
      benchingPatternScore: 15,
      rookieAcquisitionRate: 20,
      vetAcquisitionRate: 45,
      draftPickCount: 4,
      draftEarlyRoundRate: 25,
      positionPriorityConcentration: 33,
      picksTradedAway: 1,
      picksAcquired: 4,
      rebuildScore: 55,
      contentionScore: 20,
      aggressionNorm: 17,
      riskNorm: 28,
    })
    expect(scores.aggressionScore).toBeGreaterThanOrEqual(0)
    expect(scores.riskToleranceScore).toBeLessThanOrEqual(100)
  })
})
