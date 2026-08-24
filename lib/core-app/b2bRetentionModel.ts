/**
 * 30b — the B2B retention case. THE ONE PLACE THE NUMBERS LIVE.
 *
 * ⚠ EVERY NUMBER ON /core/business COMES FROM THIS FILE AND NOWHERE ELSE.
 * The handoff's copy contract is that the page states projections from a
 * documented assumption set — not measured customer results, and not numbers
 * invented at render time. So each dataset below carries the assumption string
 * that is rendered directly beneath its own chart. A dataset without an
 * `assumptions` line cannot be added: the type forbids it.
 *
 * ⚠ PROVENANCE IS PROVISIONAL AND THE PAGE SAYS SO. `MODEL_PROVENANCE.status`
 * is 'PROVISIONAL' because no B2B model owner has signed off on these curves
 * yet. That status is rendered in the page's MODEL banner, so the page cannot
 * quietly present unowned numbers as owned ones. When the owner signs off:
 * replace the series, set `owner`, set `reviewedOn`, flip status to 'REVIEWED'.
 * Nothing else in the page needs to change.
 *
 * ⚠ THE CHURN/LEAGUE-COUNT RELATIONSHIP IS CORRELATIONAL. It is labelled that
 * way in `CHURN_BY_LEAGUE_COUNT.assumptions` and the label is not optional —
 * connecting leagues does not, on its own, cause engagement. Do not reword that
 * line into a causal claim.
 *
 * ⚠ BOTH CURVES RECOVER AT M10–M12 BECAUSE OF DRAFT SEASON, NOT THE PRODUCT.
 * That attribution is an honesty commitment from the handoff. It lives in
 * `RETENTION_CURVES.assumptions` and must survive any edit to the series.
 */

export type ModelStatus = 'PROVISIONAL' | 'REVIEWED'

export type ModelProvenance = {
  status: ModelStatus
  /** Null until a named human owns these numbers. Rendered in the MODEL banner. */
  owner: string | null
  /** ISO date of the last human review, null while provisional. */
  reviewedOn: string | null
}

export const MODEL_PROVENANCE: ModelProvenance = {
  status: 'PROVISIONAL',
  owner: null,
  reviewedOn: null,
}

/** A chart's data plus the assumption set rendered under it. Never optional. */
export type ModelledSeries<T> = {
  points: T[]
  /** Rendered verbatim beneath the chart. Required by the copy contract. */
  assumptions: string
}

// ── Retention curves ────────────────────────────────────────────────────────

export type RetentionPoint = {
  /** Months after season end. 0 = the week the season finishes. */
  month: number
  /** % of the season-end cohort still active. */
  crossLeague: number
  singleLeague: number
}

export const RETENTION_CURVES: ModelledSeries<RetentionPoint> = {
  points: [
    { month: 0, crossLeague: 100, singleLeague: 100 },
    { month: 1, crossLeague: 94, singleLeague: 88 },
    { month: 2, crossLeague: 86, singleLeague: 71 },
    { month: 3, crossLeague: 79, singleLeague: 55 },
    { month: 4, crossLeague: 73, singleLeague: 44 },
    { month: 5, crossLeague: 69, singleLeague: 36 },
    { month: 6, crossLeague: 66, singleLeague: 31 },
    { month: 7, crossLeague: 64, singleLeague: 28 },
    { month: 8, crossLeague: 63, singleLeague: 27 },
    { month: 9, crossLeague: 65, singleLeague: 29 },
    { month: 10, crossLeague: 71, singleLeague: 38 },
    { month: 11, crossLeague: 79, singleLeague: 52 },
    { month: 12, crossLeague: 84, singleLeague: 61 },
  ],
  assumptions:
    'Projection, not a measured cohort. Assumes a season-end cohort of NFL-primary managers, ' +
    '“active” defined as one or more sessions in the month, and that a cross-league manager has ' +
    'at least one league still in-season or in an offseason format. Both curves turn back up at ' +
    'months 10–12 because draft season returns — that recovery is the calendar, not the product.',
}

/** The month the two curves are furthest apart. Rendered as the chart callout. */
export const RETENTION_CALLOUT_MONTH = 6

// ── Revenue by cohort (the one isometric chart) ─────────────────────────────

export type CohortRevenuePoint = {
  label: string
  /** Indexed to the single-league cohort = 100. Never a dollar figure. */
  index: number
}

/**
 * ⚠ THIS IS THE ONLY 3D CHART ON THE SITE, AND THE CONSTRAINT GENERALISES.
 * Four bars, one axis, every value numerically labelled, and the front face
 * carries the scale — depth is decoration that cannot change a reading. If a
 * future chart cannot meet all four of those conditions, it is drawn flat.
 */
export const COHORT_REVENUE: ModelledSeries<CohortRevenuePoint> = {
  points: [
    { label: '1 league', index: 100 },
    { label: '2 leagues', index: 138 },
    { label: '3–4 leagues', index: 176 },
    { label: '5+ leagues', index: 209 },
  ],
  assumptions:
    'Projection, indexed to the single-league cohort at 100 — not revenue in dollars. Assumes ' +
    'identical pricing across cohorts and that the revenue difference is driven by retained ' +
    'months, not by a higher price. Depth in this chart is decorative: the front face carries ' +
    'the scale and every bar is labelled with its own value.',
}

// ── Offseason sessions ──────────────────────────────────────────────────────

export type SessionPoint = {
  /** Calendar month label, offseason only. */
  label: string
  crossLeague: number
  singleLeague: number
}

export const OFFSEASON_SESSIONS: ModelledSeries<SessionPoint> = {
  points: [
    { label: 'Feb', crossLeague: 11.4, singleLeague: 6.2 },
    { label: 'Mar', crossLeague: 9.8, singleLeague: 3.1 },
    { label: 'Apr', crossLeague: 8.9, singleLeague: 2.4 },
    { label: 'May', crossLeague: 7.6, singleLeague: 1.6 },
    { label: 'Jun', crossLeague: 6.9, singleLeague: 1.2 },
    { label: 'Jul', crossLeague: 8.2, singleLeague: 2.0 },
    { label: 'Aug', crossLeague: 14.1, singleLeague: 9.7 },
  ],
  assumptions:
    'Projection. Sessions per active user per month, February through August. Assumes a session ' +
    'is any app open separated by 30 minutes of inactivity. August rises for both cohorts ' +
    'because drafts start — again the calendar, not the product.',
}

// ── Churn by league count ───────────────────────────────────────────────────

export type ChurnPoint = {
  label: string
  /** % of the cohort churned by month 6. */
  churnPct: number
}

export const CHURN_BY_LEAGUE_COUNT: ModelledSeries<ChurnPoint> = {
  points: [
    { label: '1 league', churnPct: 61 },
    { label: '2 leagues', churnPct: 44 },
    { label: '3–4 leagues', churnPct: 29 },
    { label: '5+ leagues', churnPct: 18 },
  ],
  assumptions:
    'Projection, and CORRELATIONAL — not causal. Managers who already play more leagues are ' +
    'already more engaged, so some of this gap is selection, not effect. Connecting leagues ' +
    'does not cause engagement on its own; it removes the reason to leave. Read this as “this ' +
    'is what the engaged cohort looks like”, never as “add a league and churn falls”.',
}

// ── The calculator ──────────────────────────────────────────────────────────

export type CalculatorInputs = {
  /** Users on the partner's platform at season end. */
  seasonEndUsers: number
  /** The partner's own month-6 retention today, as a percentage. */
  currentM6RetentionPct: number
  /** What one retained user is worth to the partner over a year, in dollars. */
  valuePerRetainedUser: number
}

export const CALCULATOR_DEFAULTS: CalculatorInputs = {
  seasonEndUsers: 250_000,
  currentM6RetentionPct: 31,
  valuePerRetainedUser: 14,
}

/**
 * The month-6 lift the model projects, expressed as a multiple of whatever the
 * partner's own retention is today rather than a flat swap to our curve. A
 * partner already retaining 55% at M6 does not get our 31% → 66% delta handed
 * to them; they get the same *ratio*, capped.
 */
export const M6_LIFT_MULTIPLE =
  RETENTION_CURVES.points[RETENTION_CALLOUT_MONTH].crossLeague /
  RETENTION_CURVES.points[RETENTION_CALLOUT_MONTH].singleLeague

/** Nobody retains everyone. The projection is capped so it cannot claim they do. */
export const RETENTION_CEILING_PCT = 92

export type CalculatorResult = {
  projectedM6RetentionPct: number
  retainedUsersToday: number
  projectedRetainedUsers: number
  incrementalUsers: number
  annualImpactUsd: number
}

/**
 * Pure. Same inputs, same output — the page recomputes on every keystroke and
 * must not depend on anything but its three arguments.
 */
export function projectRetentionImpact(inputs: CalculatorInputs): CalculatorResult {
  const users = Math.max(0, Number.isFinite(inputs.seasonEndUsers) ? inputs.seasonEndUsers : 0)
  const currentPct = clamp(inputs.currentM6RetentionPct, 0, 100)
  const value = Math.max(0, Number.isFinite(inputs.valuePerRetainedUser) ? inputs.valuePerRetainedUser : 0)

  const projectedPct = clamp(currentPct * M6_LIFT_MULTIPLE, currentPct, RETENTION_CEILING_PCT)

  const retainedToday = (users * currentPct) / 100
  const projectedRetained = (users * projectedPct) / 100
  const incremental = projectedRetained - retainedToday

  return {
    projectedM6RetentionPct: projectedPct,
    retainedUsersToday: retainedToday,
    projectedRetainedUsers: projectedRetained,
    incrementalUsers: incremental,
    annualImpactUsd: incremental * value,
  }
}

export const CALCULATOR_ASSUMPTIONS =
  'Applies the model’s month-6 lift as a multiple of your own current retention, not as a swap ' +
  'to our curve, and caps the result at ' +
  `${RETENTION_CEILING_PCT}% because no platform retains everyone. Value per retained user is ` +
  'yours to define — we do not estimate it.'

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}
