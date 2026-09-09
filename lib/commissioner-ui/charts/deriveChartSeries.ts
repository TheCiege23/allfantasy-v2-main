import type { AutomationCatalogEntry } from '../automations/decision-os-client/types'
import type { CommissionerRecommendationContract } from '../contracts'
import type { GeneratedReport } from '../reports/decision-os-client/types'
import type { CommissionerTask } from '../workspace/decision-os-client/types'
import { isTaskOpen } from '../workspace/queues'
import type { SeverityTier } from '../tokens/colors'

/**
 * Every chart series Commissioner OS derives from data a page has ALREADY fetched.
 *
 * ── WHY THESE LIVE HERE AND NOT IN THE VIEWS ─────────────────────────────────────────────────
 *
 * Six of the seven charts added in this phase need no new backend read: the task list already
 * carries `createdAt`, the report history already carries `status` and `templateName`, the
 * automation catalog already carries its outcome counts. Deriving them inside a `useMemo` in each
 * view would have worked and would have put arithmetic nobody can test without a DOM into six
 * different components. These are pure functions of their inputs, tested directly.
 *
 * ⚠ NOTHING HERE INVENTS A NUMBER, AND TWO OF THEM DELIBERATELY RETURN AN EMPTY ARRAY RATHER THAN A
 * ZERO ROW. A bar chart with every bar at zero looks like a measurement; an absent chart with a
 * sentence beside it does not. The views test for `length` and say so.
 */

export interface CategoryPoint {
  label: string
  value: number
}

export interface StackedRow {
  label: string
  values: Record<string, number>
}

const DAY_MS = 86_400_000

function wholeDaysSince(iso: string, now: Date): number | null {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return null
  return Math.max(0, Math.floor((now.getTime() - then) / DAY_MS))
}

/* ── Workspace ─────────────────────────────────────────────────────────────── */

/**
 * Open tasks by how long they have been open.
 *
 * ⚠ BANDS, NOT A DAILY HISTOGRAM. A commissioner's question is "is anything rotting in here", and
 * the answer is a shape across four buckets, not a spike on the 9th. Thirty thin bars would also
 * make the one task that has been open five weeks visually indistinguishable from noise.
 *
 * ⚠ AND ONLY OPEN TASKS. A resolved task's age is a fact about the past; including it would make the
 * chart grow forever and make a tidy queue look like a backlog.
 */
export function taskAgeBands(tasks: CommissionerTask[], now = new Date()): CategoryPoint[] {
  /*
   * ⚠ `isTaskOpen`, NOT A LOCAL STATUS TEST. This first read `status !== 'resolved' && !== 'dismissed'`
   * — two statuses that do not exist in `CommissionerTaskStatus`, so the filter excluded nothing and
   * every completed task was plotted. The unit tests passed regardless, because this repo excludes
   * every test file from `tsconfig`: the fixtures asserted against invented statuses and agreed with
   * an implementation that shared the same invention. Only the repo typecheck caught it.
   */
  const open = tasks.filter(isTaskOpen)
  if (open.length === 0) return []

  const bands: CategoryPoint[] = [
    { label: 'Today', value: 0 },
    { label: '1–6 days', value: 0 },
    { label: '1–4 weeks', value: 0 },
    { label: 'Over a month', value: 0 },
  ]

  for (const task of open) {
    const age = wholeDaysSince(task.createdAt, now)
    // An unparseable timestamp is not silently bucketed as "today", which would understate the
    // backlog. It is left out, and the total below the chart is the count of tasks actually plotted.
    if (age === null) continue
    if (age < 1) bands[0].value += 1
    else if (age < 7) bands[1].value += 1
    else if (age < 31) bands[2].value += 1
    else bands[3].value += 1
  }

  // Leading empty bands are dropped so a queue that is all one day old draws one bar, not four with
  // three at zero. Trailing ones are kept: an empty "Over a month" next to a full "Today" is the
  // reassuring half of the finding.
  const firstUsed = bands.findIndex((band) => band.value > 0)
  return firstUsed <= 0 ? bands : bands.slice(firstUsed)
}

/* ── Recommendations ──────────────────────────────────────────────────────── */

const SEVERITY_ORDER: SeverityTier[] = ['critical', 'elevated', 'advisory', 'standard', 'positive']

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'Critical',
  elevated: 'Elevated',
  advisory: 'Advisory',
  standard: 'Standard',
  positive: 'Positive',
}

/**
 * The open queue by severity.
 *
 * ⚠ ORDERED BY SEVERITY, NOT BY COUNT. `ActivityMixDonut` sorts by value and folds a long tail into
 * "Other", which is right for arbitrary categories and wrong here: severity is ordinal, and a
 * reader scanning for "how many critical" should find it in the same place every time. So this
 * returns severities in fixed order and never emits more than five slices, which is exactly the
 * donut's palette size — the fold can therefore never fire.
 */
export function recommendationsBySeverity(
  recommendations: CommissionerRecommendationContract[],
): CategoryPoint[] {
  if (recommendations.length === 0) return []
  const counts = new Map<string, number>()
  for (const rec of recommendations) {
    counts.set(rec.severity, (counts.get(rec.severity) ?? 0) + 1)
  }
  return SEVERITY_ORDER.filter((tier) => (counts.get(tier) ?? 0) > 0).map((tier) => ({
    label: SEVERITY_LABEL[tier] ?? tier,
    value: counts.get(tier) ?? 0,
  }))
}

/* ── League Health ────────────────────────────────────────────────────────── */

/**
 * Active against quiet managers, inside the intelligence window.
 *
 * 🛑 THE LABELS NAME THE WINDOW BECAUSE THE NUMBERS ARE MEANINGLESS WITHOUT IT. `totalManagers`
 * counts managers with at least one event in the lookback window, not the league's roster, so "0 of
 * 9" on a 12-team league is three separate misreadings waiting to happen. This is the same defect
 * the analytics KPI labels were fixed for; a chart legend is no safer a place to omit it.
 *
 * Returns empty when the window saw nobody at all — two zero slices draw no donut, and "we have no
 * readings for this league" is a different statement from "nobody is active".
 */
export function participationSlices(participation: {
  activeManagers: number
  totalManagers: number
}): CategoryPoint[] {
  const { activeManagers, totalManagers } = participation
  if (totalManagers <= 0) return []
  const quiet = Math.max(0, totalManagers - activeManagers)
  const slices: CategoryPoint[] = []
  if (activeManagers > 0) slices.push({ label: 'Active in window', value: activeManagers })
  if (quiet > 0) slices.push({ label: 'Quiet in window', value: quiet })
  return slices
}

/* ── Reports ──────────────────────────────────────────────────────────────── */

export const REPORT_OUTCOME_SERIES = [
  { id: 'ready', label: 'Ready' },
  { id: 'generating', label: 'Generating' },
  { id: 'failed', label: 'Failed' },
] as const

/**
 * Report runs per template, split by outcome.
 *
 * Stacked rather than two charts: the question is "which template is failing", and that is a
 * comparison within each template's own total. Horizontal in the view because template names are
 * sentences.
 */
export function reportOutcomesByTemplate(history: GeneratedReport[]): StackedRow[] {
  if (history.length === 0) return []
  const byTemplate = new Map<string, Record<string, number>>()
  for (const report of history) {
    const name = report.templateName || report.templateId
    const row = byTemplate.get(name) ?? { ready: 0, generating: 0, failed: 0 }
    // An unrecognised status is counted somewhere rather than dropped: a run that happened is a run,
    // and silently discarding it would make the chart's total disagree with the history table beside it.
    const key = report.status === 'failed' ? 'failed' : report.status === 'generating' ? 'generating' : 'ready'
    row[key] += 1
    byTemplate.set(name, row)
  }
  return [...byTemplate.entries()]
    .map(([label, values]) => ({ label, values }))
    // Most-run first, then alphabetically so the order is stable between reads.
    .sort((a, b) => sumRow(b) - sumRow(a) || a.label.localeCompare(b.label))
}

function sumRow(row: StackedRow): number {
  return Object.values(row.values).reduce((total, n) => total + n, 0)
}

/* ── Automations ──────────────────────────────────────────────────────────── */

export const AUTOMATION_OUTCOME_SERIES = [
  { id: 'succeeded', label: 'Succeeded' },
  { id: 'skipped', label: 'Skipped' },
  { id: 'failed', label: 'Failed' },
] as const

/**
 * Run outcomes per automation.
 *
 * 🛑 `skipped` IS ITS OWN SERIES AND IS NOT A FAILURE. On production `waivers.processLeague` is 2
 * completed, 0 failed, 249 skipped: stacking skips as failures would paint a job that has never
 * failed once as catastrophic, and hiding them would lose the fact that it has barely attempted
 * anything. Three series is the only honest arrangement, and it is why the view passes explicit
 * semantic colours instead of a positional palette.
 */
export function automationRunOutcomes(catalog: AutomationCatalogEntry[]): StackedRow[] {
  /*
   * ⚠ THE `runOutcomes` GUARD IS NOT DEFENSIVE PROGRAMMING FOR ITS OWN SAKE. An entry missing it
   * crashed the entire Automation Center — a `useMemo` throwing during render takes the whole tab
   * down, not just the chart. The type says the field is required and every real client supplies it;
   * a test fixture omitted it and nothing complained, because this repo excludes test files from
   * `tsconfig`, so a fixture can contradict its own type indefinitely.
   *
   * Such an entry is SKIPPED rather than defaulted to zeroes. A zero row would be a fabricated
   * measurement of a job that has runs; an absent row is visibly absent from a chart whose other
   * bars are present.
   */
  const withRuns = catalog.filter((entry) => entry.totalRunsCount > 0 && entry.runOutcomes)
  if (withRuns.length === 0) return []
  return withRuns
    .map((entry) => ({
      label: entry.name,
      values: {
        succeeded: entry.runOutcomes.succeeded,
        skipped: entry.runOutcomes.skipped,
        failed: entry.runOutcomes.failed,
      },
    }))
    .sort((a, b) => sumRow(b) - sumRow(a) || a.label.localeCompare(b.label))
}

/**
 * How long since each automation last ran.
 *
 * 🛑 THIS IS THE CHART THAT WOULD HAVE CAUGHT THE ELEVEN-WEEK WAIVER SILENCE. Judged on success rate
 * alone that job scores perfectly; the finding is entirely in the time axis, which no other surface
 * plots. An automation that has never run is included at 0 with its own label — omitting it would
 * hide the most dormant entries of all, which is precisely backwards.
 */
export function automationStaleness(catalog: AutomationCatalogEntry[], now = new Date()): CategoryPoint[] {
  if (catalog.length === 0) return []
  return catalog
    .map((entry) => ({
      label: entry.name,
      value: entry.lastRunAt ? (wholeDaysSince(entry.lastRunAt, now) ?? 0) : 0,
      neverRan: !entry.lastRunAt,
    }))
    // Most stale first — the point of the chart is the top bar.
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .map(({ label, value, neverRan }) => ({
      // The label carries the "never" case, because a 0-day bar and a never-run bar are the same
      // height and opposite findings.
      label: neverRan ? `${label} (never run)` : label,
      value,
    }))
}
