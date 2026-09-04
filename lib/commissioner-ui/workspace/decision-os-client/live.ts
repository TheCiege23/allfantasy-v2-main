import type { WorkspaceClient } from './types'

/**
 * Phase 3.8 — Commissioner Workspace audited against the established
 * pattern (Mission Control, League Health, Manager Intelligence,
 * Recommendations Center) and, unlike every prior module, found to have
 * **no partial real wiring worth attempting at all** — not even the
 * "call a real endpoint, extract what's real, degrade the rest" shape
 * those four modules used.
 *
 * `CommissionerTask`'s defining fields — `status` (a 6-state lifecycle a
 * commissioner transitions by hand: open → in_progress → completed/
 * archived, etc.), `createdAt`/`updatedAt` (implying a persisted, mutable
 * record), `dueAt` — describe a stateful task-tracking system. Decision OS
 * has no analog anywhere: not in the currently-ported Intelligence API,
 * not in any unported Phase 6 classifier (`archetypes`, `benchmark`,
 * `company`, `dna`, `patterns`, `recommendations` — no task/workflow
 * concept in any of them, confirmed by a repository-wide search, not
 * assumed), and structurally could not exist without Decision OS becoming
 * a stateful system rather than a read-only, freshly-recomputed
 * intelligence pipeline. This module's own demo fixture confirms it: some
 * tasks (confirming co-commissioner permissions, sharing a league digest,
 * documenting tiebreaker rules) have no Decision OS relevance at all —
 * Workspace is a commissioner-side task tracker that *links to* other
 * modules' intelligence for context, not a projection of Decision OS
 * output.
 *
 * Deriving tasks from real recommendations was considered and rejected:
 * even then, `status`/`createdAt`/`updatedAt` would have to be invented
 * (nothing tracks whether a commissioner already started or finished a
 * given item), which is exactly the fabrication this whole program has
 * never done. See COMMISSIONER_WORKSPACE_LIVE_INTEGRATION_REPORT.md.
 *
 * No functional change from the pre-Phase-3.8 placeholder — this is a
 * documented conclusion, not a missed opportunity.
 */
export const liveWorkspaceClient: WorkspaceClient = {
  async getTasks() {
    return {
      data: null,
      error: {
        category: 'upstream_unavailable',
        message: 'The live Decision OS backend is not yet integrated in this environment.',
        moduleId: 'workspace',
        retryable: false,
        timestamp: new Date().toISOString(),
      },
      source: 'live',
      timestamp: new Date().toISOString(),
    }
  },
}
