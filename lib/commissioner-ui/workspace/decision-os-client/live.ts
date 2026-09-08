import { isLiveReady } from '../../liveReadiness'
import { resolveActiveLeagueId } from '../../resolveActiveLeagueId'
import { hasEverBeenScanned, readLeagueTasks } from '@/lib/commissioner-workspace/taskStore'
import { COMMISSIONER_ALL_NAV_ITEMS } from '../../navigation/moduleNav'
import type { CommissionerModuleId } from '../../navigation/moduleNav'
import type { CommissionerTask, CommissionerTaskStatus, WorkspaceClient } from './types'
import type { SeverityTier } from '../../tokens/colors'

/**
 * Commissioner Workspace, wired to its own persisted task store.
 *
 * ── WHAT THIS MODULE USED TO SAY, AND WHY IT WAS RIGHT ───────────────────────────────────────
 *
 * Phase 3.8 audited Workspace and declined to wire it, with a reason worth keeping verbatim:
 * `status`, `createdAt` and `updatedAt` "would have to be invented (nothing tracks whether a
 * commissioner already started or finished a given item), which is exactly the fabrication this
 * whole program has never done." It also established, by repository-wide search rather than
 * assumption, that Decision OS has no task or workflow concept anywhere — not in the ported
 * Intelligence API and not in any Phase 6 classifier.
 *
 * Both findings still hold. Decision OS still has no task concept, and inventing a lifecycle is
 * still fabrication. What changed is that the missing thing was BUILT rather than worked around:
 * `commissioner_workspace_tasks` (migration 20260908120000) persists the lifecycle, so `createdAt`
 * is when the condition was first detected, `status` is whatever the commissioner last set, and
 * nothing on this page is invented. The refusal is answered by supplying what it said was
 * missing, not by lowering the bar it set.
 *
 * ── WHAT FEEDS IT ────────────────────────────────────────────────────────────────────────────
 *
 * `lib/commissioner-workspace/taskSources.ts` detects conditions from the same warehouse reads
 * League Analytics uses, so a task can never disagree with the panel a commissioner would open to
 * check it. `lib/automation/jobs/workspace/` runs that detection on a schedule through the real
 * automation engine.
 *
 * 🛑 THE WRITER SHIPPED IN THE SAME COMMIT AS THIS READ. Root CLAUDE.md's `ingestCFBDStats` case
 * is the reason: a surface pointed at a table nothing refreshes fails silently and looks correct,
 * which is worse than the honest error this file used to return.
 */

/** The store's `priority` column carries the shared SeverityTier vocabulary; nothing else is valid. */
const SEVERITY: ReadonlySet<string> = new Set<SeverityTier>([
  'critical',
  'elevated',
  'standard',
  'advisory',
  'positive',
])

/**
 * Derived from the nav list rather than restated, so a module added to the sidebar is immediately
 * linkable and a module removed from it stops being linkable — one definition, not two that drift.
 *
 * ⚠ ALL nav items, not `COMMISSIONER_MODULE_NAV_ITEMS`. That constant is the PRIMARY sidebar only
 * and omits `activity` and `help`, both of which are real modules with real routes — using it here
 * would silently drop any link to either, and a dropped link leaves no trace to debug from.
 */
const MODULE_IDS: ReadonlySet<string> = new Set(COMMISSIONER_ALL_NAV_ITEMS.map((item) => item.id))

const STATUSES: ReadonlySet<string> = new Set<CommissionerTaskStatus>([
  'open',
  'in_progress',
  'waiting_on_manager',
  'waiting_on_league_vote',
  'completed',
  'archived',
])

/*
 * ⚠ THE COLUMNS ARE TEXT, SO THE VALUES ARE VALIDATED HERE RATHER THAN CAST.
 * `status` and `priority` are TEXT and not Postgres enums — deliberately, so adding a state is a
 * code change and not a lock — which means the database will happily hold a value this union has
 * never heard of. A blind `as CommissionerTaskStatus` would push that straight into the UI, where
 * `severityTokens[priority]` is a record lookup: an unknown key yields `undefined` and the badge
 * renders unstyled with no error anywhere. Falling back keeps a bad row visible and legible.
 */
function toStatus(value: string): CommissionerTaskStatus {
  return STATUSES.has(value) ? (value as CommissionerTaskStatus) : 'open'
}

function toPriority(value: string): SeverityTier {
  return SEVERITY.has(value) ? (value as SeverityTier) : 'standard'
}

/**
 * Related links, dropping any whose `moduleId` is not a module that exists.
 *
 * ⚠ A LINK IS THE ONE FIELD WHERE A FALLBACK WOULD BE WORSE THAN DROPPING IT. An unrecognised
 * status can sensibly default to `open` and an unrecognised priority to `standard` — both are
 * legible and roughly right. Substituting a module for a link is not: it sends a commissioner to
 * a page that has nothing to do with the task, which is a confident wrong answer where silence
 * would have been honest.
 */
function toRelatedLinks(
  links: { label: string; moduleId: string; href: string }[],
): CommissionerTask['relatedLinks'] {
  return links.flatMap((link) =>
    MODULE_IDS.has(link.moduleId)
      ? [{ label: link.label, moduleId: link.moduleId as CommissionerModuleId, href: link.href }]
      : [],
  )
}

function notYetIntegrated(message: string) {
  return {
    category: 'upstream_unavailable' as const,
    message,
    moduleId: 'workspace' as const,
    retryable: false,
    timestamp: new Date().toISOString(),
  }
}

export const liveWorkspaceClient: WorkspaceClient = {
  async getTasks() {
    const timestamp = new Date().toISOString()

    if (!(await isLiveReady('workspace'))) {
      return {
        data: null,
        error: notYetIntegrated('The live Decision OS backend is not yet integrated in this environment.'),
        source: 'live',
        timestamp,
      }
    }

    const leagueId = await resolveActiveLeagueId()
    if (!leagueId) {
      return {
        data: null,
        error: notYetIntegrated('No active league could be resolved for this session.'),
        source: 'live',
        timestamp,
      }
    }

    const [tasks, scanned] = await Promise.all([
      readLeagueTasks(leagueId),
      hasEverBeenScanned(leagueId),
    ])

    /*
     * 🛑 ZERO ROWS IS TWO DIFFERENT CLAIMS AND THEY RENDER IDENTICALLY.
     *
     * "We scanned this league and found nothing" and "nothing has ever scanned this league" both
     * produce an empty array, and the Workspace view draws the same reassuring "Nothing needs your
     * attention right now" for either. The second one is an unwired feature presented as a clean
     * bill of health — the exact failure the analytics data-window work exists to prevent, and the
     * one this module refused to ship in Phase 3.8. So an unscanned league returns the honest
     * error instead of an empty list.
     *
     * The distinction comes from the automation ledger rather than from the task table, because a
     * healthy league writes no task rows at all — the tasks can never evidence their own absence.
     */
    if (tasks.length === 0 && !scanned) {
      return {
        data: null,
        error: notYetIntegrated(
          'This league has not been scanned yet. The workspace task scan runs daily; an empty list here would claim a clean bill of health nothing has checked.',
        ),
        source: 'live',
        timestamp,
      }
    }

    const data: CommissionerTask[] = tasks.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      status: toStatus(row.status),
      priority: toPriority(row.priority),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(row.dueAt ? { dueAt: row.dueAt.toISOString() } : {}),
      automationCandidate: row.automationCandidate,
      relatedLinks: toRelatedLinks(row.relatedLinks),
    }))

    return { data, error: null, source: 'live', timestamp }
  },
}
