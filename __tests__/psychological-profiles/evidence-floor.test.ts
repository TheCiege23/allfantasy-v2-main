import { describe, expect, it } from 'vitest'

import { resolveProfileLabels } from '@/lib/psychological-profiles/ProfileLabelResolver'
import {
  EVIDENCE_FLOORS,
  evaluateDimension,
  summarizeEvidence,
} from '@/lib/psychological-profiles/ProfileEvidenceFloor'
import {
  gateScores,
  summarizeEvidenceRecords,
} from '@/lib/psychological-profiles/ManagerBehaviorQueryService'

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
    positionSampleCoverage: 0,
    draftEarlyRoundRelative: 0,
    positionConcentrationRelative: 0,
    tradeFrequencyRelative: 0,
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
    expect(labels).toContain('rookie-heavy')
    // Draft labels are allowed; what must stay absent is anything resting on the
    // trade or roster streams, which were never observed here.
    expect(labels).not.toContain('conservative')
    expect(labels).not.toContain('quiet strategist')
    expect(labels).not.toContain('trade-heavy')

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
        tradeFrequencyRelative: -1.4,
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

describe('a label must be able to come out differently', () => {
  it('does not stamp "rookie-heavy" on everyone who ever drafted', () => {
    // The live regression: with no acquisitions observed, rookieAcquisitionRate
    // was (0 + picks) / (0 + 0 + picks) = 100 for EVERY manager, so all 12
    // managers in a real league came back with the identical label. A claim that
    // cannot come out any other way is not an observation about the manager.
    //
    // Draft evidence is genuinely present here (35 picks clears the floor), so
    // the evidence gate cannot catch this — the ratio itself had to be fixed.
    const labels = resolveProfileLabels(signals({ draftPickCount: 35, rookieAcquisitionRate: 0 }))
    expect(labels).not.toContain('rookie-heavy')
  })

  it('still says rookie-heavy when a real acquisition mix leans rookie', () => {
    // The fix must not make the label unreachable: a manager whose acquisitions
    // really do skew young has demonstrated the trait and should be named.
    const labels = resolveProfileLabels(signals({ draftPickCount: 35, rookieAcquisitionRate: 85 }))
    expect(labels).toContain('rookie-heavy')
  })
})

describe('the draft dimension can now say what it sees', () => {
  // Draft is often the ONLY populated dimension, so without a vocabulary the
  // engine measured real differences between managers and reported nothing.
  it('separates a premium-pick drafter from a volume drafter', () => {
    const early = resolveProfileLabels(signals({ draftPickCount: 44, draftEarlyRoundRelative: 1.4 }))
    const late = resolveProfileLabels(signals({ draftPickCount: 27, draftEarlyRoundRelative: -1.3 }))
    expect(early).toContain('early-round focused')
    expect(early).not.toContain('late-round accumulator')
    expect(late).toContain('late-round accumulator')
    expect(late).not.toContain('early-round focused')
  })

  it('calls nobody a late-round accumulator for never having drafted', () => {
    // draftEarlyRoundRate is 0 with no picks, and the threshold is an upper
    // bound — the exact shape that produced "conservative" from emptiness.
    expect(resolveProfileLabels(signals({ draftPickCount: 0, draftEarlyRoundRelative: -2 }))).toEqual([])
  })

  it('withholds positional claims when the player join missed', () => {
    // Draft facts key players by provider id; when that lookup fails,
    // concentration comes back 0. Without the coverage guard that reads as a
    // perfectly balanced drafter for a manager whose picks we never identified.
    const blind = resolveProfileLabels(
      signals({ draftPickCount: 44, positionConcentrationRelative: -2, positionSampleCoverage: 0 })
    )
    expect(blind).not.toContain('balanced drafter')
    expect(blind).not.toContain('position-focused')

    const seen = resolveProfileLabels(
      signals({ draftPickCount: 44, positionConcentrationRelative: -1.5, positionSampleCoverage: 95 })
    )
    expect(seen).toContain('balanced drafter')
  })
})

describe('scores are not shown for dimensions we never observed', () => {
  const raw = {
    aggressionScore: 0,
    activityScore: 0,
    tradeFrequencyScore: 0,
    waiverFocusScore: 0,
    riskToleranceScore: 0,
  }

  it('reports unmeasured as null, never as zero', () => {
    // Every score column is Float @default(0), so an unwatched manager reads as
    // a confident "0% risk tolerance" — a claim about a real person built from
    // an absent row.
    const evidence = summarizeEvidenceRecords([
      { evidenceType: 'draft_evidence_count', value: 44 },
      { evidenceType: 'trade_evidence_count', value: 0 },
      { evidenceType: 'roster_evidence_count', value: 0 },
    ])
    const shown = gateScores(raw, evidence)
    expect(shown.riskToleranceScore).toBeNull()
    expect(shown.aggressionScore).toBeNull()
    expect(shown.waiverFocusScore).toBeNull()
    expect(evidence.observedDimensions).toEqual(['draft'])
    // Draft feeds none of activity's three inputs, so it cannot license one.
    expect(shown.activityScore).toBeNull()
  })

  it('shows a real zero once the dimension has been observed', () => {
    // A manager watched across 9 trade actions who still scores 0 aggression has
    // earned that 0. The gate must not swallow measured lows.
    const evidence = summarizeEvidenceRecords([
      { evidenceType: 'trade_evidence_count', value: 9 },
      { evidenceType: 'draft_evidence_count', value: 0 },
      { evidenceType: 'roster_evidence_count', value: 0 },
    ])
    const shown = gateScores(raw, evidence)
    expect(shown.aggressionScore).toBe(0)
    expect(shown.riskToleranceScore).toBe(0)
    expect(shown.waiverFocusScore).toBeNull()
  })

  it('treats a profile written before counts existed as unmeasured', () => {
    // Absent records must not be read as "nothing happened" — that is a guess,
    // and guessing is what this gate exists to stop.
    const evidence = summarizeEvidenceRecords([])
    expect(evidence.anySufficient).toBe(false)
    expect(gateScores(raw, evidence).activityScore).toBeNull()
  })
})

describe('a label must describe the manager, not the league he is in', () => {
  it('stays silent when every manager in the league drafts alike', () => {
    // Early-round share is dominated by how deep the league drafts. Measured
    // live: a 44-round IDP dynasty sat all 14 of its managers at 20-23%, and a
    // fixed threshold labelled every one of them "late-round accumulator" — a
    // fact about the league's settings presented as a personality. Relative
    // standing is 0 for all of them, and no one is distinctive.
    const typical = resolveProfileLabels(signals({ draftPickCount: 40, draftEarlyRoundRelative: 0 }))
    expect(typical).not.toContain('late-round accumulator')
    expect(typical).not.toContain('early-round focused')
  })

  it('does not call a manager trade-heavy for a league simply being old', () => {
    // Trade counts are cumulative across seasons, so an absolute bar of 6 was
    // cleared by 9 of 12 managers in a five-season dynasty — roughly one trade a
    // season each. Busy is a comparison, and it is made against leaguemates.
    const average = resolveProfileLabels(signals({ tradeCount: 7, tradeFrequencyRelative: -0.6 }))
    expect(average).not.toContain('trade-heavy')

    const standout = resolveProfileLabels(signals({ tradeCount: 29, tradeFrequencyRelative: 1.6 }))
    expect(standout).toContain('trade-heavy')
  })

  it('keeps the absolute floor so a quiet league cannot crown a two-trade manager', () => {
    // Being the busiest in a league where nobody trades is not being busy.
    const busiestOfTheQuiet = resolveProfileLabels(
      signals({ tradeCount: 3, tradeFrequencyRelative: 2.2 })
    )
    expect(busiestOfTheQuiet).not.toContain('trade-heavy')
  })
})
