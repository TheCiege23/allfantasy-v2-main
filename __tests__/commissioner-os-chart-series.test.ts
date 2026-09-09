import { describe, expect, it } from 'vitest'
import {
  automationRunOutcomes,
  automationStaleness,
  participationSlices,
  recommendationsBySeverity,
  reportOutcomesByTemplate,
  taskAgeBands,
} from '@/lib/commissioner-ui/charts/deriveChartSeries'
import type { AutomationCatalogEntry } from '@/lib/commissioner-ui/automations/decision-os-client/types'
import type { CommissionerRecommendationContract } from '@/lib/commissioner-ui/contracts'
import type { GeneratedReport } from '@/lib/commissioner-ui/reports/decision-os-client/types'
import type { CommissionerTask } from '@/lib/commissioner-ui/workspace/decision-os-client/types'

/**
 * The chart derivations.
 *
 * Every assertion here is about a way a chart can state something untrue while looking correct —
 * an empty series drawn as a measurement, a skip counted as a failure, a never-run job hidden
 * because it has no timestamp. The arithmetic is the easy part.
 */

const NOW = new Date('2026-09-09T12:00:00.000Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

function task(over: Partial<CommissionerTask> = {}): CommissionerTask {
  return {
    id: 't-1',
    title: 'A task',
    description: '',
    status: 'open',
    priority: 'standard',
    createdAt: daysAgo(0),
    updatedAt: daysAgo(0),
    automationCandidate: false,
    relatedLinks: [],
    ...over,
  }
}

function automation(over: Partial<AutomationCatalogEntry> = {}): AutomationCatalogEntry {
  return {
    id: 'job.a',
    name: 'Job A',
    description: '',
    category: 'scheduling',
    status: 'enabled',
    health: 'positive',
    schedule: { triggerType: 'schedule', description: 'Daily' },
    totalRunsCount: 0,
    successRatePercent: 0,
    runOutcomes: { succeeded: 0, failed: 0, skipped: 0 },
    relatedLinks: [],
    ...over,
  }
}

describe('taskAgeBands', () => {
  it('buckets open tasks by how long they have been open', () => {
    const bands = taskAgeBands(
      [
        task({ id: 'a', createdAt: daysAgo(0) }),
        task({ id: 'b', createdAt: daysAgo(3) }),
        task({ id: 'c', createdAt: daysAgo(10) }),
        task({ id: 'd', createdAt: daysAgo(60) }),
      ],
      NOW,
    )
    expect(bands.map((b) => [b.label, b.value])).toEqual([
      ['Today', 1],
      ['1–6 days', 1],
      ['1–4 weeks', 1],
      ['Over a month', 1],
    ])
  })

  /*
   * 🛑 THESE STATUSES ARE THE REAL ONES, AND THE FIRST VERSION OF THIS TEST INVENTED THEM.
   * It asserted against `'resolved'` and `'dismissed'`, which are not members of
   * `CommissionerTaskStatus` — and the implementation filtered on the same two invented names, so the
   * test agreed with the bug and passed. Every completed task was being plotted. This repo excludes
   * all test files from `tsconfig`, so nothing about the fixture could have caught it; the repo
   * typecheck of the implementation did.
   *
   * Workspace's terminal statuses are `completed` and `archived`, and `isTaskOpen` in
   * `workspace/queues.ts` is now the single place that says so.
   */
  it('counts only tasks that are still open', () => {
    const bands = taskAgeBands(
      [
        task({ id: 'a', status: 'open', createdAt: daysAgo(2) }),
        task({ id: 'b', status: 'completed', createdAt: daysAgo(2) }),
        task({ id: 'c', status: 'archived', createdAt: daysAgo(2) }),
      ],
      NOW,
    )
    expect(bands.reduce((sum, b) => sum + b.value, 0)).toBe(1)
  })

  /*
   * 🛑 AN EMPTY QUEUE RETURNS NO SERIES, NOT FOUR ZERO BARS. A chart with every bar at zero looks
   * like a measurement of a league with nothing happening; an absent chart with a sentence beside it
   * says there is nothing open. The views branch on `length`.
   */
  it('returns nothing at all when no task is open', () => {
    expect(taskAgeBands([], NOW)).toEqual([])
    expect(taskAgeBands([task({ status: 'completed' })], NOW)).toEqual([])
  })

  it('drops leading empty bands but keeps trailing ones', () => {
    // Everything a month old: the younger bands would be three zero bars in front of the finding.
    const old = taskAgeBands([task({ createdAt: daysAgo(45) })], NOW)
    expect(old.map((b) => b.label)).toEqual(['Over a month'])

    // Everything new: the empty older bands are the reassuring half and stay.
    const fresh = taskAgeBands([task({ createdAt: daysAgo(0) })], NOW)
    expect(fresh.map((b) => b.label)).toEqual(['Today', '1–6 days', '1–4 weeks', 'Over a month'])
  })

  it('leaves an unparseable timestamp out rather than calling it new', () => {
    const bands = taskAgeBands([task({ id: 'a', createdAt: 'not-a-date' }), task({ id: 'b', createdAt: daysAgo(0) })], NOW)
    // Bucketing the bad row as "Today" would understate a backlog; it is simply not plotted.
    expect(bands.reduce((sum, b) => sum + b.value, 0)).toBe(1)
  })
})

describe('recommendationsBySeverity', () => {
  const rec = (severity: CommissionerRecommendationContract['severity'], id: string) =>
    ({ id, title: 't', rationale: 'r', severity, category: 'administrative', sourceModuleId: 'recommendations', createdAt: daysAgo(1) }) as CommissionerRecommendationContract

  /*
   * ⚠ SEVERITY IS ORDINAL, SO THE ORDER IS FIXED. The donut sorts arbitrary categories by value,
   * which is right for activity types and wrong here: a reader scanning for "how many critical"
   * should find it in the same place every time, not wherever its count happens to place it.
   */
  it('orders by severity, not by count', () => {
    const mix = recommendationsBySeverity([
      rec('standard', 'a'), rec('standard', 'b'), rec('standard', 'c'),
      rec('critical', 'd'),
    ])
    expect(mix.map((s) => s.label)).toEqual(['Critical', 'Standard'])
    expect(mix.map((s) => s.value)).toEqual([1, 3])
  })

  it('omits severities with no recommendations, and returns nothing for an empty queue', () => {
    expect(recommendationsBySeverity([rec('critical', 'a')]).map((s) => s.label)).toEqual(['Critical'])
    expect(recommendationsBySeverity([])).toEqual([])
  })
})

describe('participationSlices', () => {
  it('splits the window into active and quiet', () => {
    expect(participationSlices({ activeManagers: 4, totalManagers: 9 })).toEqual([
      { label: 'Active in window', value: 4 },
      { label: 'Quiet in window', value: 5 },
    ])
  })

  it('drops a zero side rather than drawing it', () => {
    expect(participationSlices({ activeManagers: 9, totalManagers: 9 })).toEqual([
      { label: 'Active in window', value: 9 },
    ])
    expect(participationSlices({ activeManagers: 0, totalManagers: 9 })).toEqual([
      { label: 'Quiet in window', value: 9 },
    ])
  })

  /*
   * "We have no readings for this league" is a different statement from "nobody is active", and a
   * donut of two zeroes would make the first look like the second.
   */
  it('returns nothing when the window saw nobody at all', () => {
    expect(participationSlices({ activeManagers: 0, totalManagers: 0 })).toEqual([])
  })
})

describe('reportOutcomesByTemplate', () => {
  const report = (templateName: string, status: GeneratedReport['status'], id: string) =>
    ({ id, templateId: 't', templateName, status, format: 'pdf', generatedAt: daysAgo(1), generatedByLabel: 'x', summary: '', sizeLabel: '', shareStatus: 'private', relatedLinks: [] }) as GeneratedReport

  it('groups runs per template and splits them by outcome, most-run first', () => {
    const rows = reportOutcomesByTemplate([
      report('Weekly digest', 'ready', 'a'),
      report('Weekly digest', 'ready', 'b'),
      report('Weekly digest', 'failed', 'c'),
      report('Season review', 'ready', 'd'),
    ])
    expect(rows[0].label).toBe('Weekly digest')
    expect(rows[0].values).toEqual({ ready: 2, generating: 0, failed: 1 })
    expect(rows[1].values.ready).toBe(1)
  })

  /*
   * A run that happened is a run. Dropping an unrecognised status would make the chart's total
   * disagree with the history table rendered directly beneath it.
   */
  it('counts an unfamiliar status rather than discarding the run', () => {
    const rows = reportOutcomesByTemplate([report('Digest', 'something-new' as GeneratedReport['status'], 'a')])
    const total = Object.values(rows[0].values).reduce((sum, n) => sum + n, 0)
    expect(total).toBe(1)
  })

  it('returns nothing for an empty history', () => {
    expect(reportOutcomesByTemplate([])).toEqual([])
  })
})

describe('automationRunOutcomes', () => {
  /*
   * 🛑 THE ASSERTION THIS CHART EXISTS FOR. On production `waivers.processLeague` is 2 completed,
   * 0 failed, 249 skipped. Folding skips into failures paints a job that has never failed once as
   * catastrophic; hiding them loses the fact that it has barely attempted anything. Three series.
   */
  it('keeps skipped separate from failed', () => {
    const rows = automationRunOutcomes([
      automation({ id: 'waivers', name: 'Waiver batch', totalRunsCount: 251, runOutcomes: { succeeded: 2, failed: 0, skipped: 249 } }),
    ])
    expect(rows[0].values).toEqual({ succeeded: 2, skipped: 249, failed: 0 })
  })

  it('omits an automation that has never run, which the staleness chart shows instead', () => {
    const rows = automationRunOutcomes([
      automation({ id: 'a', name: 'Ran', totalRunsCount: 3, runOutcomes: { succeeded: 3, failed: 0, skipped: 0 } }),
      automation({ id: 'b', name: 'Never', totalRunsCount: 0 }),
    ])
    expect(rows.map((r) => r.label)).toEqual(['Ran'])
  })

  it('returns nothing when no automation has ever run', () => {
    expect(automationRunOutcomes([automation({ totalRunsCount: 0 })])).toEqual([])
  })
})

describe('automationStaleness', () => {
  /*
   * 🛑 THIS IS THE CHART THAT WOULD HAVE CAUGHT THE ELEVEN-WEEK WAIVER SILENCE. Judged on success
   * rate that job scores perfectly; the entire finding lives on the time axis.
   */
  it('sorts most-stale first', () => {
    const bars = automationStaleness([
      automation({ id: 'a', name: 'Fresh', lastRunAt: daysAgo(1) }),
      automation({ id: 'b', name: 'Stale', lastRunAt: daysAgo(79) }),
    ], NOW)
    expect(bars[0]).toEqual({ label: 'Stale', value: 79 })
    expect(bars[1]).toEqual({ label: 'Fresh', value: 1 })
  })

  /*
   * ⚠ A NEVER-RUN JOB AND A JOB THAT RAN TODAY BOTH PLOT AT ZERO, AND THEY ARE OPPOSITE FINDINGS.
   * The label is the only thing that can carry the difference, so it does — omitting the row would
   * hide the most dormant automations of all, which is precisely backwards.
   */
  it('labels a never-run automation rather than dropping it', () => {
    const bars = automationStaleness([automation({ id: 'b', name: 'Never', lastRunAt: undefined })], NOW)
    expect(bars).toEqual([{ label: 'Never (never run)', value: 0 }])
  })

  it('returns nothing for an empty catalog', () => {
    expect(automationStaleness([], NOW)).toEqual([])
  })
})
