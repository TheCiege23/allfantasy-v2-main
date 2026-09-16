/**
 * Sports OS — point 1: declared performance budgets.
 *
 * A budget is a NUMBER WE COMMIT TO, written down in one place, so that "the app feels slow" stops
 * being an opinion. Everything that measures a duration — a render, a card, a query, an import, a
 * notification — can ask this module what it was allowed to take and get a verdict back.
 *
 * ⚠ THESE ARE TARGETS, NOT MEASUREMENTS. They were chosen from the shape of the product (a shell
 * should feel instant; a card may take a moment; an import may take a minute) and from the one
 * figure `docs/observability/TRACING.md` records — a 1,836 ms /core render trace. Nothing here is
 * derived from a p95 we have actually held, and a budget nobody has ever met is a wish. Re-set them
 * from Sentry once there is a week of per-screen data, and say so in the commit when you do.
 *
 * PURE, TOTAL AND DEPENDENCY-FREE, for the same reason `lib/observability/requestContext.ts` is: it
 * runs on every request and in the browser. It never throws, never does I/O, never imports an app
 * module.
 *
 * ⚠ AN UNKNOWN KEY RESOLVES TO A DEFAULT RATHER THAN THROWING. A budget that can fail a render is
 * worse than the slowness it reports — the same rule the pre-push smoke guard follows.
 */

import type { DeviceClass } from '@/lib/observability/requestContext'

/**
 * What is being timed. These are PHASES, not features: a phase is a thing a user waits on, and two
 * features in the same phase should feel the same.
 */
export type BudgetPhase =
  /** Server time until the app chrome has everything it renders. Point 2. */
  | 'shell'
  /** One independently-streamed card, measured from the start of its read chain. Point 3. */
  | 'card'
  /** A whole screen's content behind the shell. */
  | 'screen'
  /** A user-initiated action that is not a navigation: submit, toggle, filter. */
  | 'interaction'
  /** Database time for one request — the sum, not the wall clock (see `af.db.ms`). */
  | 'db'
  /** One provider round trip inside an ingestion path. */
  | 'provider'
  /** A league import, end to end. */
  | 'import'
  /** Enqueue-to-delivered for one notification. */
  | 'notification'
  /** A scheduled job's whole run. */
  | 'job'

/**
 * ⚠ `unknown` IS A VERDICT VALUE ON PURPOSE, NOT A GAP. A duration that is `NaN` or `Infinity` is
 * not a measurement, and collapsing it into `within` is precisely the check-that-cannot-fail shape
 * CLAUDE.md is about: a hung read would report as comfortably inside budget. The first version of
 * this module did exactly that — `Number.isFinite(Infinity)` is false, so an unbounded duration
 * clamped to 0 and read as `within`. Its own test caught it. A status that is neither pass nor fail
 * is not a pass.
 */
export type BudgetVerdict = 'within' | 'warn' | 'over' | 'unknown'

export type Budget = {
  /** The target. At or under this is `within`. */
  targetMs: number
  /** Over this is `over`. Between target and ceiling is `warn`. */
  ceilingMs: number
}

export type BudgetKey = {
  phase: BudgetPhase
  /** For `card` / `screen` / `shell`: the /core screen segment. For `job`: the job name. */
  name?: string | null
  device?: DeviceClass | null
}

export type BudgetEvaluation = {
  phase: BudgetPhase
  name: string | null
  device: DeviceClass
  observedMs: number
  budget: Budget
  verdict: BudgetVerdict
  /** observed / target. 1.0 is exactly on target; 2.0 is twice as slow as promised. */
  ratio: number
}

/**
 * Base budgets, before the device multiplier.
 *
 * ⚠ `db` is DATABASE TIME, summed across a request's queries — a `Promise.all` of four 80 ms reads
 * spends 320 ms of this budget in 80 ms of wall clock. That is deliberate: the budget is about the
 * load we put on Postgres, which is the thing that runs out first.
 */
const BASE_BUDGETS: Record<BudgetPhase, Budget> = {
  shell: { targetMs: 400, ceilingMs: 800 },
  card: { targetMs: 800, ceilingMs: 2_000 },
  screen: { targetMs: 1_200, ceilingMs: 2_500 },
  interaction: { targetMs: 200, ceilingMs: 500 },
  db: { targetMs: 300, ceilingMs: 900 },
  provider: { targetMs: 1_500, ceilingMs: 5_000 },
  import: { targetMs: 20_000, ceilingMs: 60_000 },
  notification: { targetMs: 30_000, ceilingMs: 120_000 },
  job: { targetMs: 60_000, ceilingMs: 180_000 },
}

/**
 * Device multiplier, applied to the CLIENT-FELT phases only.
 *
 * ⚠ A SERVER PHASE DOES NOT GET ONE, and this is the part that is easy to get wrong. A query does
 * not run slower because the caller is on a phone; giving `db` a mobile multiplier would hide a
 * genuine regression behind the user's hardware. Only `shell`, `card`, `screen` and `interaction`
 * — the ones whose duration includes the network and the device — are scaled.
 */
const DEVICE_MULTIPLIER: Record<DeviceClass, number> = {
  mobile: 1.5,
  tablet: 1.25,
  desktop: 1,
  // A bot is not a user waiting; measuring it against a human budget is noise either way.
  bot: 3,
  unknown: 1.25,
}

const CLIENT_FELT: ReadonlySet<BudgetPhase> = new Set<BudgetPhase>(['shell', 'card', 'screen', 'interaction'])

/**
 * Per-name overrides, for the cases where one screen or job is legitimately different from its
 * phase's default. Keyed `<phase>:<name>`.
 *
 * ⚠ AN OVERRIDE IS A PROMISE THAT THE THING IS DIFFERENT IN KIND, not an excuse for one that is
 * slow. If you find yourself widening an entry to make a verdict go green, the verdict was right.
 */
const NAME_OVERRIDES: Record<string, Budget> = {
  // The home fans out to ~19 reads; its slowest card is the whole screen's duration.
  'screen:home': { targetMs: 1_500, ceilingMs: 3_000 },
  // `dash34` feeds eight cards from one read — it is allowed to cost more than a single card.
  'card:dash34': { targetMs: 1_200, ceilingMs: 2_500 },
  // Chained reads: these open when their chain does, not when their own query does.
  'card:trades': { targetMs: 1_200, ceilingMs: 2_500 },
  'card:since-last-visit': { targetMs: 1_500, ceilingMs: 3_000 },
  // A first import walks every roster in a league; it is a job wearing a request's clothes.
  'import:first': { targetMs: 45_000, ceilingMs: 120_000 },
  'import:resync': { targetMs: 15_000, ceilingMs: 45_000 },
}

const DEFAULT_BUDGET: Budget = { targetMs: 1_000, ceilingMs: 3_000 }

function safeName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null
  const trimmed = name.trim().toLowerCase()
  if (!trimmed || trimmed.length > 48) return null
  return /^[a-z0-9][a-z0-9-]*$/.test(trimmed) ? trimmed : null
}

function scale(budget: Budget, multiplier: number): Budget {
  return {
    targetMs: Math.round(budget.targetMs * multiplier),
    ceilingMs: Math.round(budget.ceilingMs * multiplier),
  }
}

/**
 * The budget for one key: the phase's base, replaced by a name override when there is one, then
 * scaled by the device multiplier if the phase is client-felt.
 */
export function budgetFor(key: BudgetKey): Budget {
  const name = safeName(key.name)
  const base = (name ? NAME_OVERRIDES[`${key.phase}:${name}`] : undefined) ?? BASE_BUDGETS[key.phase] ?? DEFAULT_BUDGET
  if (!CLIENT_FELT.has(key.phase)) return { ...base }
  const device: DeviceClass = key.device ?? 'unknown'
  return scale(base, DEVICE_MULTIPLIER[device] ?? 1)
}

/**
 * Measure an observed duration against its budget. Never throws.
 *
 * Two degenerate inputs, handled differently on purpose:
 *
 *   - A small NEGATIVE duration is clock skew around a genuinely fast operation. It clamps to 0 and
 *     reads `within`, which is true.
 *   - `NaN` or `Infinity` is NOT a measurement, so it reads `unknown` — never `within`. See the note
 *     on `BudgetVerdict`.
 */
export function evaluateBudget(key: BudgetKey, observedMs: number): BudgetEvaluation {
  const budget = budgetFor(key)
  if (!Number.isFinite(observedMs)) {
    return {
      phase: key.phase,
      name: safeName(key.name),
      device: key.device ?? 'unknown',
      observedMs: 0,
      budget,
      verdict: 'unknown',
      ratio: 0,
    }
  }
  const observed = Math.max(0, observedMs)
  const verdict: BudgetVerdict =
    observed > budget.ceilingMs ? 'over' : observed > budget.targetMs ? 'warn' : 'within'
  return {
    phase: key.phase,
    name: safeName(key.name),
    device: key.device ?? 'unknown',
    observedMs: Math.round(observed),
    budget,
    verdict,
    // targetMs is never 0 in this table, but a future entry could be — guard rather than divide by it.
    ratio: budget.targetMs > 0 ? Number((observed / budget.targetMs).toFixed(3)) : 0,
  }
}

/** Every declared budget, for a docs page or an admin panel. Sorted for a stable diff. */
export function allBudgets(): Array<{ key: string; budget: Budget }> {
  const rows = [
    ...Object.entries(BASE_BUDGETS).map(([phase, budget]) => ({ key: phase, budget })),
    ...Object.entries(NAME_OVERRIDES).map(([key, budget]) => ({ key, budget })),
  ]
  return rows.sort((a, b) => a.key.localeCompare(b.key))
}

export const BUDGET_PHASES: readonly BudgetPhase[] = Object.keys(BASE_BUDGETS) as BudgetPhase[]
