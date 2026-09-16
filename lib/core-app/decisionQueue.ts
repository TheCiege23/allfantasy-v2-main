import type { CoreIssue } from '@/lib/core-app/outstandingIssues'

/**
 * The /core home's decision queue: every open item across every league, ranked by urgency, with
 * the first five shown before anything else on the page.
 *
 * WHY A SECOND ORDER, AND NOT THE ONE THE ISSUES ARRIVE IN. The issues reach the home in two
 * orders glued together: `mergeDash34Issues` prepends what the summary knows is happening NOW
 * (an empty starting slot, a starter ruled out, a draft on the clock), and `deriveOutstandingIssues`
 * sorts its own rows soonest-deadline-first. That second sort puts EVERY timed row above every
 * untimed one, whatever its severity — so a draft thirty days out (`info`, but timed) outranked
 * stale league data (`warn`, untimed). Fine for a list read top to bottom; wrong for a queue that
 * shows five rows and hides the rest.
 *
 * The rule, in order:
 *   1. Severity — `bad`, then `warn`, then `info`.
 *   2. Inside `bad`, an item with NO deadline comes first. Every untimed `bad` row states something
 *      that has already happened (a slot scoring zero, a starter ruled out, a draft live), which
 *      outranks a deadline that has not arrived yet. Inside `warn` and `info`, an untimed row is
 *      the opposite — nothing is counting down — so it sinks below the timed ones.
 *   3. Soonest deadline.
 *   4. The order the rows arrived in. The sort is stable, so ties keep the loaders' own judgement.
 *
 * Nothing is invented, dropped, or restated: the queue is a permutation of its input.
 */

export const TOP_DECISION_LIMIT = 5

const SEVERITY_RANK: Record<CoreIssue['severity'], number> = { bad: 0, warn: 1, info: 2 }

export function rankDecisions(issues: readonly CoreIssue[]): CoreIssue[] {
  return issues
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => {
      const bySeverity = SEVERITY_RANK[a.issue.severity] - SEVERITY_RANK[b.issue.severity]
      if (bySeverity !== 0) return bySeverity
      const aTime = deadlineMs(a.issue)
      const bTime = deadlineMs(b.issue)
      if (aTime !== bTime) {
        // An untimed row is "now" for `bad` and "whenever" for everything else.
        const untimed = a.issue.severity === 'bad' ? -Infinity : Infinity
        return (aTime ?? untimed) - (bTime ?? untimed)
      }
      return a.index - b.index
    })
    .map(({ issue }) => issue)
}

/** The ranked queue, split where the home stops showing rows until the reader asks for more. */
export function splitDecisionQueue(
  issues: readonly CoreIssue[],
  limit: number = TOP_DECISION_LIMIT,
): { top: CoreIssue[]; rest: CoreIssue[]; total: number } {
  const ranked = rankDecisions(issues)
  return { top: ranked.slice(0, limit), rest: ranked.slice(limit), total: ranked.length }
}

/**
 * A deadline as epoch ms, or null. A `Date` that crossed the server→client boundary can arrive as
 * an ISO string, and an unparseable one is treated as no deadline rather than as NaN, which would
 * make the comparator inconsistent and the order undefined.
 */
function deadlineMs(issue: CoreIssue): number | null {
  const raw = issue.deadline as Date | string | null
  if (raw == null) return null
  const ms = raw instanceof Date ? raw.getTime() : new Date(raw).getTime()
  return Number.isNaN(ms) ? null : ms
}
