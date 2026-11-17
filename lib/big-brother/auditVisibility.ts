/**
 * 🛑 WHAT A LEAGUE MEMBER MAY SEE OF THE BIG BROTHER AUDIT LOG.
 *
 * GET /api/leagues/[id]/big-brother/audit returned every row's raw metadata to any member. Two kinds of row carry
 * vote totals:
 *  - `eviction` stores `voteCount` (votes to evict per nominee), and
 *  - a commissioner `rerun_vote_tally` (`phase_transition`) stores `votesByTarget` — WHILE VOTING IS STILL OPEN.
 * A league shows exact totals only when `publicVoteTotalsVisibility === 'exact'` (the default is `evicted_only`,
 * and the home and chat announcements both honour it), so the log let any member read hidden totals, and live
 * ones, from the History screen (2026-11-09 audit). Never who voted for whom — the rows do not hold that — but the
 * totals alone break the league's setting.
 *
 * The commissioner sees everything. Everyone else gets the totals only on a published `eviction` / `finale_vote`
 * result in a league that shows exact totals; every other vote-count field is removed.
 */
const VOTE_KEYS = ['voteCount', 'votesByTarget'] as const
const PUBLISHED_RESULTS = new Set(['eviction', 'finale_vote'])

type AuditRowForViewer<T> = { eventType: string; metadata: T }

export function redactBigBrotherAuditForViewer<R extends AuditRowForViewer<unknown>>(
  rows: R[],
  viewer: { isCommissioner: boolean; showExactTotals: boolean },
): R[] {
  if (viewer.isCommissioner) return rows
  return rows.map((row) => {
    const m = row.metadata
    if (!m || typeof m !== 'object' || Array.isArray(m)) return row
    if (viewer.showExactTotals && PUBLISHED_RESULTS.has(row.eventType)) return row
    if (!VOTE_KEYS.some((k) => k in (m as Record<string, unknown>))) return row
    const copy = { ...(m as Record<string, unknown>) }
    for (const k of VOTE_KEYS) delete copy[k]
    return { ...row, metadata: copy }
  })
}
