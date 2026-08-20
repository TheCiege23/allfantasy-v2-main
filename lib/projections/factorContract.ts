/**
 * Factor contract — every projection input declares whether it was included,
 * how much it was trusted, and why it was excluded when it was.
 *
 * This is Phase 0 of the coaching data spec, and it deliberately ships BEFORE any
 * coaching data exists. The problem it solves is not "we lack coaching data" — it
 * is that a missing factor can be silently imputed to a league-average default
 * that reads to the user as a real measurement. That failure is invisible in the
 * output, survives code review, and is worse than having no factor at all.
 *
 * The rule, stated once:
 *
 *   A FACTOR IS NEVER SILENTLY INCLUDED, AND NEVER SILENTLY EXCLUDED.
 *
 * A consumer that cannot tell the difference between "this defense is neutral" and
 * "we have never seen this matchup" will eventually present the second as the
 * first. Every field here exists to keep those two apart.
 */

export type ConfidenceTier = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT'

export type ExclusionReason =
  | 'NO_DATA_SOURCE'
  | 'INSUFFICIENT_SAMPLE'
  | 'STALE_DATA'
  | 'ATTRIBUTION_UNRESOLVED'
  | 'OUT_OF_COVERAGE_WINDOW'
  | 'DISABLED'

/**
 * Weight applied per confidence tier.
 *
 * ⚠ INSUFFICIENT IS EXACTLY 0, AND THAT IS THE WHOLE POINT OF THIS FILE. Any
 * change that gives it a non-zero default reintroduces the silent-imputation bug
 * this contract exists to prevent. A test asserts this.
 */
export const TIER_WEIGHT: Record<ConfidenceTier, number> = {
  HIGH: 1,
  MEDIUM: 0.5,
  LOW: 0.25,
  INSUFFICIENT: 0,
}

export type FactorContribution = {
  /** Stable identifier, e.g. 'opponent_history', 'weather', 'coaching'. */
  factor: string
  /** False means it contributed NOTHING — weightApplied is 0 and points is 0. */
  included: boolean
  /** Present only when excluded. */
  reason: ExclusionReason | null
  /** Null when excluded — an excluded factor has no confidence, not low confidence. */
  confidence: ConfidenceTier | null
  weightApplied: number
  /** Points contributed AFTER weighting. Zero whenever included is false. */
  points: number
  /** The unweighted effect, kept so a user can see what was damped and by how much. */
  rawPoints: number
  /** Sample size behind this factor, where the notion applies. */
  sampleSize: number | null
  /** Human-readable, safe to display. */
  detail: string
}

/**
 * Build an EXCLUDED contribution.
 *
 * ⚠ `points` AND `weightApplied` ARE HARD-ZEROED HERE RATHER THAN TAKEN FROM THE
 * CALLER. An excluded factor that still carries points is the exact bug this
 * contract prevents, so the type does not offer the caller a way to express it.
 */
export function excludedFactor(
  factor: string,
  reason: ExclusionReason,
  detail: string
): FactorContribution {
  return {
    factor,
    included: false,
    reason,
    confidence: null,
    weightApplied: 0,
    points: 0,
    rawPoints: 0,
    sampleSize: null,
    detail,
  }
}

/**
 * Build an INCLUDED contribution, applying the tier weight.
 *
 * Passing INSUFFICIENT here does NOT produce an included factor — it degrades to
 * an exclusion, because a factor weighted 0 has not been included by any
 * meaningful definition and must not be reported as though it had.
 */
export function includedFactor(args: {
  factor: string
  confidence: ConfidenceTier
  rawPoints: number
  sampleSize: number | null
  detail: string
}): FactorContribution {
  if (args.confidence === 'INSUFFICIENT') {
    return excludedFactor(args.factor, 'INSUFFICIENT_SAMPLE', args.detail)
  }
  const weight = TIER_WEIGHT[args.confidence]
  return {
    factor: args.factor,
    included: true,
    reason: null,
    confidence: args.confidence,
    weightApplied: weight,
    points: Math.round(args.rawPoints * weight * 100) / 100,
    rawPoints: Math.round(args.rawPoints * 100) / 100,
    sampleSize: args.sampleSize,
    detail: args.detail,
  }
}

/**
 * Composite confidence across independent axes.
 *
 * ⚠ THE MINIMUM, NEVER THE AVERAGE. The spec's reasoning is worth restating
 * because averaging looks so reasonable: a coaching profile with impeccable
 * sourcing and an enormous sample but an UNRESOLVED PLAY-CALLER is not
 * medium-confidence. It may be describing the wrong human entirely. Averaging
 * would launder that into a comfortable number; the minimum keeps the weakest
 * axis in charge, which is the only safe reading.
 */
export function compositeConfidence(axes: ConfidenceTier[]): ConfidenceTier {
  if (axes.length === 0) return 'INSUFFICIENT'
  const order: ConfidenceTier[] = ['INSUFFICIENT', 'LOW', 'MEDIUM', 'HIGH']
  let worst = 3
  for (const a of axes) worst = Math.min(worst, order.indexOf(a))
  return order[worst]
}

/**
 * Sample-size tier.
 *
 * ⚠ THESE THRESHOLDS ARE PLACEHOLDERS PENDING CALIBRATION ON REAL DISTRIBUTIONS —
 * the spec says so explicitly and it is repeated here because a number in code
 * acquires an authority the doc it came from never had. `games` defaults suit
 * per-player matchup history; pass `scale: 'plays'` for play-level rates, where
 * the counts are three orders of magnitude larger.
 */
export function sampleConfidence(
  n: number,
  scale: 'games' | 'plays' = 'games'
): ConfidenceTier {
  const [high, medium, low] = scale === 'plays' ? [1500, 500, 100] : [10, 4, 1]
  if (n >= high) return 'HIGH'
  if (n >= medium) return 'MEDIUM'
  if (n >= low) return 'LOW'
  return 'INSUFFICIENT'
}

/**
 * The coaching factor, which currently has NO DATA SOURCE.
 *
 * ⚠ THIS FUNCTION EXISTS SO THE ABSENCE IS EXPLICIT IN THE OUTPUT RATHER THAN
 * ABSENT FROM IT. There is no coaching table in this schema; the honest thing is
 * for every projection to carry a coaching factor that says so, so a consumer can
 * render "coaching: not included — no data source" instead of the user assuming
 * it was quietly folded in.
 *
 * When the coaching layer lands, this returns a real contribution and every
 * consumer already handles it — no consumer changes required.
 */
export function coachingFactorUnavailable(): FactorContribution {
  return excludedFactor(
    'coaching',
    'NO_DATA_SOURCE',
    'no coaching staff data is ingested yet, so coaching is not part of this projection'
  )
}

/** Sum only the included factors. Excluded ones contribute 0 by construction. */
export function totalFactorPoints(factors: FactorContribution[]): number {
  const sum = factors.reduce((acc, f) => acc + (f.included ? f.points : 0), 0)
  return Math.round(sum * 100) / 100
}

/** What a UI needs to explain the projection without over-claiming. */
export function summariseFactors(factors: FactorContribution[]): {
  included: string[]
  excluded: Array<{ factor: string; reason: ExclusionReason }>
  totalPoints: number
} {
  return {
    included: factors.filter((f) => f.included).map((f) => f.factor),
    excluded: factors
      .filter((f) => !f.included)
      .map((f) => ({ factor: f.factor, reason: f.reason as ExclusionReason })),
    totalPoints: totalFactorPoints(factors),
  }
}
