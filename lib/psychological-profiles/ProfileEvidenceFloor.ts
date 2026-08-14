/**
 * ProfileEvidenceFloor — how much real behaviour a psychological claim requires.
 *
 * WHY THIS EXISTS. resolveProfileLabels() reads thresholds that are all upper
 * bounds for the quiet archetypes, so a manager with NOTHING recorded satisfies
 * them trivially. Measured against the live resolver:
 *
 *   zero trades, zero claims, zero picks  ->  ["conservative", "quiet strategist"]
 *
 * That is a personality invented from absence. It is the same defect as a trade
 * grading C on zero points or a devy prospect scoring 33 with no signals, except
 * this one names a REAL PERSON and — under the asymmetric display model — can be
 * shown to their leaguemate as competitive intel. A manager who simply joined
 * last week is not "conservative"; we have not met him.
 *
 * PER-DIMENSION, NOT ONE BLOB. Trade, draft and roster psychology have separate
 * evidence streams, and a manager can be richly observed in one and invisible in
 * another. This league carries 420 draft picks and few trades: that is a real
 * draft profile and no trade profile, and reporting exactly that is more useful
 * than blending them into a single confident label.
 */

import type { BehaviorSignalsOutput } from './BehaviorSignalAggregator'

export type PsychDimension = 'trade' | 'draft' | 'roster'

export type DimensionConfidence = 'high' | 'moderate' | 'low'

export type DimensionEvidence = {
  dimension: PsychDimension
  /** Countable actions backing this dimension. */
  evidenceCount: number
  /** True once there is enough to characterise the manager at all. */
  sufficient: boolean
  confidence: DimensionConfidence | null
  /** Plain-language statement of what is missing, for the UI to show verbatim. */
  shortfall: string | null
}

/**
 * Floors are deliberately conservative and set per dimension.
 *
 * A single trade tells you nothing about how someone trades — the second and
 * third are what reveal a pattern. Draft picks are far more plentiful, so the
 * floor is higher in absolute terms but easier to clear.
 */
export const EVIDENCE_FLOORS: Record<PsychDimension, { min: number; confident: number }> = {
  trade: { min: 3, confident: 8 },
  draft: { min: 10, confident: 40 },
  roster: { min: 5, confident: 20 },
}

function countFor(dimension: PsychDimension, s: BehaviorSignalsOutput): number {
  switch (dimension) {
    case 'trade':
      // Picks moved are trade behaviour too, and in dynasty often the clearest.
      return (s.tradeCount ?? 0) + (s.picksTradedAway ?? 0) + (s.picksAcquired ?? 0)
    case 'draft':
      return s.draftPickCount ?? 0
    case 'roster':
      // Waiver claims are the countable part; lineup churn is a rate, not a count,
      // so it informs the label but cannot substitute for having acted at all.
      return s.waiverClaimCount ?? 0
    default:
      return 0
  }
}

export function evaluateDimension(
  dimension: PsychDimension,
  signals: BehaviorSignalsOutput,
): DimensionEvidence {
  const floor = EVIDENCE_FLOORS[dimension]
  const evidenceCount = countFor(dimension, signals)

  if (evidenceCount < floor.min) {
    return {
      dimension,
      evidenceCount,
      sufficient: false,
      confidence: null,
      shortfall:
        evidenceCount === 0
          ? `No ${dimension} activity recorded yet — nothing to characterise.`
          : `Only ${evidenceCount} ${dimension} action${evidenceCount === 1 ? '' : 's'} recorded; ${floor.min} needed before a pattern means anything.`,
    }
  }

  return {
    dimension,
    evidenceCount,
    sufficient: true,
    confidence: evidenceCount >= floor.confident ? 'high' : evidenceCount >= floor.min * 2 ? 'moderate' : 'low',
    shortfall: null,
  }
}

export function evaluateAllDimensions(signals: BehaviorSignalsOutput): Record<PsychDimension, DimensionEvidence> {
  return {
    trade: evaluateDimension('trade', signals),
    draft: evaluateDimension('draft', signals),
    roster: evaluateDimension('roster', signals),
  }
}

/**
 * Overall profile confidence across dimensions, and whether ANY dimension has
 * enough to say something. A profile with no sufficient dimension must not be
 * persisted with labels — see PsychologicalProfileEngine.
 */
export function summarizeEvidence(signals: BehaviorSignalsOutput): {
  dimensions: Record<PsychDimension, DimensionEvidence>
  anySufficient: boolean
  overallConfidence: DimensionConfidence | null
  observedDimensions: PsychDimension[]
  missingDimensions: PsychDimension[]
} {
  const dimensions = evaluateAllDimensions(signals)
  const list = Object.values(dimensions)
  const sufficient = list.filter((d) => d.sufficient)

  const rank: Record<DimensionConfidence, number> = { low: 1, moderate: 2, high: 3 }
  // The overall claim is only as strong as the BEST-evidenced dimension, but a
  // single well-observed dimension does not make the whole manager well known.
  const best = sufficient.reduce<DimensionConfidence | null>((acc, d) => {
    if (!d.confidence) return acc
    if (!acc) return d.confidence
    return rank[d.confidence] > rank[acc] ? d.confidence : acc
  }, null)

  const overallConfidence =
    best == null ? null : sufficient.length === 1 && best === 'high' ? 'moderate' : best

  return {
    dimensions,
    anySufficient: sufficient.length > 0,
    overallConfidence,
    observedDimensions: sufficient.map((d) => d.dimension),
    missingDimensions: list.filter((d) => !d.sufficient).map((d) => d.dimension),
  }
}
