/**
 * What a league's PER-POSITION reception weight does to a player's value. PURE.
 *
 * 🛑 THE CHART CANNOT EXPRESS THIS, WHICH IS WHY IT IS A SEPARATE ADJUSTMENT. FantasyCalc takes a
 * single `ppr` number and applies it to every position. A league that pays tight ends 1.0 and
 * everyone else 0.5 is not `ppr=0.5` and is not `ppr=1` — it is a shape the chart has no parameter
 * for, so no amount of choosing the right chart gets it right.
 *
 * ⚠ AND IT IS NOT A TE FEATURE. Sleeper carries `bonus_rec_te`, `bonus_rec_wr` and `bonus_rec_rb`;
 * a WR-premium league hits the identical gap. Special-casing tight ends would leave the same bug
 * for the next format, which is why this reads a weight per position rather than a boolean.
 *
 * ── HOW IT IS DERIVED, AND WHERE THE NUMBERS COME FROM ──────────────────────────────────────
 *
 * A +w change in reception weight adds `w x receptions` points. What that is WORTH depends on how
 * much of a position's production already comes from catching the ball — the same bonus is
 * transformative for a tight end and worthless to a quarterback. Measured on production 2025
 * (40,473 game rows), over the STARTABLE band of each position rather than everyone rostered:
 *
 *     pos   median rec   non-rec pts   half-PPR pts   value of +0.5/rec
 *     QB             0           143            143             +0.0%
 *     RB            30            85            100            +15.0%
 *     WR            46            59             82            +28.0%
 *     TE            44            49             71            +31.2%
 *
 * ⚠ MEASURED ON STARTERS ON PURPOSE. A table built from every rostered body is dominated by
 * third-stringers who catch nothing, which understates the effect for exactly the players a trade
 * is about.
 */

/** Fractional POINTS gain per +1.0 of reception weight, by position. Twice the +0.5 column above. */
export const POINTS_GAIN_PER_RECEPTION_POINT: Readonly<Record<string, number>> = {
  QB: 0.0,
  RB: 0.30,
  WR: 0.56,
  TE: 0.624,
}

/**
 * Points are not value, and the gap between them is this exponent.
 *
 * ⚠ THE SAME FREE PARAMETER AS `leagueShape.DEMAND_EXPONENT`, AND DELIBERATELY THE SAME VALUE.
 * A 31% points increase does not make a tight end 31% more valuable: every tight end gets it, so
 * within-position order is unchanged and what actually moves is his standing against the RBs and
 * WRs competing for the same FLEX slots. Damping expresses that.
 *
 * ⚠ IT IS CORROBORATED FROM AN INDEPENDENT DIRECTION, which is the only reason to trust a free
 * parameter. `dynasty-tiers.getPositionMultiplier` has carried a hand-set TE premium of
 * `1.35 / 1.15 = 1.174x` for a long time. This model, given a full 1.0-vs-0.5 TE premium, produces
 * `sqrt(1.312) = 1.145x` — arrived at from measured production, landing beside a number set by
 * judgement. Two methods agreeing is weak evidence; it is still more than one method alone.
 */
export const SCORING_FIT_EXPONENT = 0.5

/** Bounds. A scoring rule should tilt a value, never redefine it. */
export const SCORING_FIT_MIN = 0.5
export const SCORING_FIT_MAX = 2.0

/** Sleeper-shaped scoring settings. Provider-neutral: any `{ rec, bonus_rec_* }` blob works. */
export type ScoringSettings = Record<string, unknown>

function numberAt(settings: ScoringSettings | null | undefined, key: string): number | null {
  const v = settings?.[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

/**
 * The reception weight this league pays a given position, or null when the settings do not say.
 *
 * ⚠ NULL IS NOT ZERO. A league whose settings we could not read has an UNKNOWN reception rule, and
 * treating that as "no receptions count" would silently price every PPR league as standard. The
 * caller must handle null by declining to adjust, not by adjusting to a default.
 */
export function receptionWeightForPosition(
  settings: ScoringSettings | null | undefined,
  position: string | null | undefined,
): number | null {
  const base = numberAt(settings, 'rec')
  if (base == null) return null
  const pos = (position ?? '').trim().toUpperCase()
  if (!pos) return base
  const bonus = numberAt(settings, `bonus_rec_${pos.toLowerCase()}`) ?? 0
  return base + bonus
}

export interface ScoringFit {
  /** Multiply a chart value by this. Exactly 1 when the league matches the chart's assumption. */
  multiplier: number
  /** What the league pays this position per reception. */
  leagueWeight: number
  /** What the chart assumed — a single weight for every position. */
  referenceWeight: number
  /** Undamped points ratio, before the exponent. Kept so a surface can show the working. */
  pointsRatio: number
  reason: string
}

/**
 * How much a chart value should move for THIS position under THIS league's reception rules.
 *
 * `referenceWeight` is what the chart was fetched with — FantasyCalc's single `ppr`. Pass the same
 * number the market request used, or the adjustment is measured against a chart nobody fetched.
 *
 * ⚠ RETURNS null RATHER THAN 1.0 WHEN IT CANNOT TELL. A multiplier of 1 asserts "this league
 * matches the chart", which is a claim; null says "no opinion", which is the honest answer when
 * the settings are unreadable or the position is one whose reception dependence was never
 * measured. `applyFormatFit` makes the same refusal when it has no `LeagueShape`.
 */
export function scoringFit(
  settings: ScoringSettings | null | undefined,
  position: string | null | undefined,
  referenceWeight: number,
): ScoringFit | null {
  const pos = (position ?? '').trim().toUpperCase()
  const gain = POINTS_GAIN_PER_RECEPTION_POINT[pos]
  if (gain == null) return null
  if (!Number.isFinite(referenceWeight)) return null

  const leagueWeight = receptionWeightForPosition(settings, pos)
  if (leagueWeight == null) return null

  const delta = leagueWeight - referenceWeight
  const pointsRatio = 1 + delta * gain

  /* A rule that would zero or invert a player's production is not a scoring tilt; refuse it. */
  if (!(pointsRatio > 0)) return null

  const raw = Math.pow(pointsRatio, SCORING_FIT_EXPONENT)
  const multiplier = Math.min(SCORING_FIT_MAX, Math.max(SCORING_FIT_MIN, raw))

  const reason =
    delta === 0
      ? `${pos} receptions are worth ${leagueWeight} here, matching the chart — no adjustment`
      : `${pos} receptions are worth ${leagueWeight} here vs ${referenceWeight} on the chart` +
        ` (${delta > 0 ? '+' : ''}${Number(delta.toFixed(2))}/catch), which is ` +
        `${((pointsRatio - 1) * 100).toFixed(0)}% of this position's points`

  return { multiplier, leagueWeight, referenceWeight, pointsRatio, reason }
}

/**
 * One sentence naming every position this league's reception rules move, or null when none do.
 *
 * 🛑 A SURFACE THAT SHOWS ONLY THE ADJUSTED NUMBER HAS HIDDEN THAT IT MOVED, which is the exact
 * objection `applyFormat` records against folding a multiplier into a base value. Any surface
 * pricing with `playerValueForLeague` owes the reader this line.
 *
 * ⚠ A move under 0.05% is omitted rather than printed as "+0%". It is a rounding artefact of a
 * league whose reception rule all but matches the chart, and naming it would imply a difference
 * the numbers on screen do not show.
 */
export function describeScoringFit(
  settings: ScoringSettings | null | undefined,
  referenceWeight: number,
): string | null {
  const moved: string[] = []
  for (const pos of Object.keys(POINTS_GAIN_PER_RECEPTION_POINT)) {
    const fit = scoringFit(settings, pos, referenceWeight)
    if (!fit || fit.multiplier === 1) continue
    const pct = Number(((fit.multiplier - 1) * 100).toFixed(1))
    if (pct === 0) continue
    moved.push(`${pos} ${pct > 0 ? '+' : ''}${pct}%`)
  }
  if (moved.length === 0) return null
  return `Adjusted for this league’s own reception rules, which the ${referenceWeight} PPR chart cannot express: ${moved.join(', ')}.`
}
