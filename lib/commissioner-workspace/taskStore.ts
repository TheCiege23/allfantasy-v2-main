import { prisma } from '@/lib/prisma'
import { detectLeagueTasks, type WorkspaceTaskCandidate } from './taskSources'

/**
 * The persisted half of Commissioner Workspace: reconcile detected conditions against stored rows,
 * and read them back.
 *
 * ── WHY THIS EXISTS, GIVEN THAT WORKSPACE DELIBERATELY SHIPPED UNWIRED ───────────────────────
 *
 * `lib/commissioner-ui/workspace/decision-os-client/live.ts` refused to wire this module and gave
 * a precise reason: `status`, `createdAt` and `updatedAt` "would have to be invented (nothing
 * tracks whether a commissioner already started or finished a given item), which is exactly the
 * fabrication this whole program has never done."
 *
 * That reasoning was correct, and it is an argument for a STORE rather than against wiring. With
 * rows, `createdAt` is when the condition was first detected, `status` is whatever the
 * commissioner last set, and nothing is invented. The refusal is answered by building the missing
 * thing, not by relaxing the standard.
 *
 * ── WHY THE WRITER IS IN THE SAME COMMIT AS THE READ ─────────────────────────────────────────
 *
 * 🛑 Root CLAUDE.md's worked example is `ingestCFBDStats`: a read pointed at a table nothing
 * refreshes is WORSE than the live call it replaced, because it fails silently and looks correct.
 * `reconcileLeagueTasks` below is that writer, driven by the `workspace.refreshTasks` automation
 * job. Neither half is useful alone and neither ships alone.
 *
 * ── WHY IT IS NOT UNDER lib/commissioner-ui/ ─────────────────────────────────────────────────
 *
 * `.eslintrc.json` bars `lib/commissioner-ui/**` from importing prisma, from raw SQL, and from
 * `findUnique`, with a bounded exemption list of exactly three grandfathered files and a test
 * asserting a fourth cannot appear without explaining itself. The same rule sent
 * `leagueWarehouseReads` to `lib/league-history/`; this follows it rather than widening the list.
 *
 * ⚠ NO `findUnique` ANYWHERE BELOW, including on the unique `(leagueId, sourceKey)` pair it would
 * fit perfectly. Its `where` takes only unique fields, so it cannot carry a soft-delete filter and
 * returns deleted rows. `findFirst` throughout, for the same reason the warehouse reader gives.
 */

/** Workspace's own lifecycle vocabulary. Mirrors `CommissionerTaskStatus` in the UI module. */
export type WorkspaceTaskStatus =
  | 'open'
  | 'in_progress'
  | 'waiting_on_manager'
  | 'waiting_on_league_vote'
  | 'completed'
  | 'archived'

/**
 * States a commissioner has already settled. A detector must never reopen one of these or drag it
 * back to `open`: they said they were done, and a scheduled job is not entitled to argue.
 */
const SETTLED: ReadonlySet<string> = new Set<WorkspaceTaskStatus>(['completed', 'archived'])

/** Rows the queues treat as live work. */
const UNRESOLVED: ReadonlySet<string> = new Set<WorkspaceTaskStatus>([
  'open',
  'in_progress',
  'waiting_on_manager',
  'waiting_on_league_vote',
])

export interface StoredWorkspaceTask {
  id: string
  leagueId: string
  sourceKey: string
  title: string
  description: string
  status: string
  priority: string
  dueAt: Date | null
  automationCandidate: boolean
  relatedLinks: { label: string; moduleId: string; href: string }[]
  createdAt: Date
  updatedAt: Date
  lastSeenAt: Date
  resolvedAt: Date | null
  autoResolvedAt: Date | null
}

export interface ReconcileOutcome {
  leagueId: string
  /** Conditions detected this run. */
  detected: number
  /** Rows written for the first time. */
  opened: number
  /** Rows whose visible content changed (title, description, priority). */
  changed: number
  /** Rows re-observed with nothing to change — `lastSeenAt` moved and nothing else. */
  unchanged: number
  /** Open rows whose condition has stopped being true, closed as `completed`. */
  autoResolved: number
}

function toRelatedLinks(value: unknown): StoredWorkspaceTask['relatedLinks'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    const label = typeof row.label === 'string' ? row.label : null
    const moduleId = typeof row.moduleId === 'string' ? row.moduleId : null
    const href = typeof row.href === 'string' ? row.href : null
    return label && moduleId && href ? [{ label, moduleId, href }] : []
  })
}

/**
 * Reconcile one league's detected conditions against what is stored.
 *
 * The three cases, and the reason each is separate rather than an upsert:
 *
 *   - NEW condition          -> insert, `createdAt` = first detection. That timestamp is the whole
 *                               reason this table exists, so it is written once and never touched.
 *   - KNOWN, still true      -> bump `lastSeenAt`. Update the visible fields ONLY if they actually
 *                               differ, because `updatedAt` must mean "this changed", not "the job
 *                               ran" — a column that moves every scheduled run cannot carry the
 *                               first meaning while being read as it.
 *   - KNOWN, no longer true  -> close it as `completed` with `autoResolvedAt` set. Separate from
 *                               `resolvedAt` so a queue can tell "you fixed this" from "this
 *                               stopped being true", which are different facts about the league.
 *
 * 🛑 A SETTLED ROW IS NEVER REOPENED BY A DETECTOR. If a commissioner archives "your data is
 * stale" and the data is still stale tomorrow, the row stays archived — `lastSeenAt` still moves,
 * so the condition is not lost, but their decision stands. A task list that resurrects dismissed
 * items is a task list people stop opening.
 */
export async function reconcileLeagueTasks(leagueId: string, now = new Date()): Promise<ReconcileOutcome> {
  const candidates = await detectLeagueTasks(leagueId, now)
  const existing = await prisma.commissionerWorkspaceTask.findMany({ where: { leagueId } })
  const byKey = new Map(existing.map((row) => [row.sourceKey, row]))

  const outcome: ReconcileOutcome = {
    leagueId,
    detected: candidates.length,
    opened: 0,
    changed: 0,
    unchanged: 0,
    autoResolved: 0,
  }

  for (const candidate of candidates) {
    const row = byKey.get(candidate.sourceKey)

    if (!row) {
      await prisma.commissionerWorkspaceTask.create({
        data: {
          leagueId,
          sourceKey: candidate.sourceKey,
          title: candidate.title,
          description: candidate.description,
          priority: candidate.priority,
          automationCandidate: candidate.automationCandidate,
          relatedLinks: candidate.relatedLinks,
          status: 'open',
          createdAt: now,
          updatedAt: now,
          lastSeenAt: now,
        },
      })
      outcome.opened += 1
      continue
    }

    // Settled by a person. Record that we still see the condition; change nothing else.
    if (SETTLED.has(row.status)) {
      await prisma.commissionerWorkspaceTask.update({
        where: { id: row.id },
        data: { lastSeenAt: now },
      })
      outcome.unchanged += 1
      continue
    }

    const visiblyChanged =
      row.title !== candidate.title ||
      row.description !== candidate.description ||
      row.priority !== candidate.priority

    await prisma.commissionerWorkspaceTask.update({
      where: { id: row.id },
      data: visiblyChanged
        ? {
            title: candidate.title,
            description: candidate.description,
            priority: candidate.priority,
            automationCandidate: candidate.automationCandidate,
            relatedLinks: candidate.relatedLinks,
            lastSeenAt: now,
            updatedAt: now,
          }
        : { lastSeenAt: now },
    })

    if (visiblyChanged) outcome.changed += 1
    else outcome.unchanged += 1
  }

  const detectedKeys = new Set(candidates.map((c) => c.sourceKey))
  for (const row of existing) {
    if (detectedKeys.has(row.sourceKey)) continue
    if (SETTLED.has(row.status)) continue

    await prisma.commissionerWorkspaceTask.update({
      where: { id: row.id },
      data: { status: 'completed', autoResolvedAt: now, updatedAt: now },
    })
    outcome.autoResolved += 1
  }

  return outcome
}

/**
 * One league's tasks for the Workspace view.
 *
 * Unresolved first and newest first within that, because the queues above the list are filters
 * over this one array — the order it arrives in IS the order every queue renders.
 */
export async function readLeagueTasks(leagueId: string): Promise<StoredWorkspaceTask[]> {
  const rows = await prisma.commissionerWorkspaceTask.findMany({
    where: { leagueId },
    orderBy: [{ createdAt: 'desc' }],
  })

  return rows
    .map((row) => ({
      id: row.id,
      leagueId: row.leagueId,
      sourceKey: row.sourceKey,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      dueAt: row.dueAt,
      automationCandidate: row.automationCandidate,
      relatedLinks: toRelatedLinks(row.relatedLinks),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastSeenAt: row.lastSeenAt,
      resolvedAt: row.resolvedAt,
      autoResolvedAt: row.autoResolvedAt,
    }))
    .sort((a, b) => {
      const liveA = UNRESOLVED.has(a.status) ? 0 : 1
      const liveB = UNRESOLVED.has(b.status) ? 0 : 1
      if (liveA !== liveB) return liveA - liveB
      return b.createdAt.getTime() - a.createdAt.getTime()
    })
}

/**
 * Has this league ever been scanned?
 *
 * 🛑 THE READ PATH NEEDS THIS AND CANNOT DERIVE IT FROM AN EMPTY LIST. Zero rows means either "we
 * looked and this league is in good shape" or "nothing has ever looked" — opposite claims that
 * render identically as an empty queue, and the second one silently presents an unwired feature as
 * a clean bill of health. That is the same failure the analytics `dataWindow` exists to prevent,
 * and it is worth one extra query to keep it from reappearing here.
 *
 * Answered from the automation ledger rather than from the task table, because a league with no
 * findings writes no task rows — so the tasks themselves can never evidence that a scan happened.
 */
export async function hasEverBeenScanned(leagueId: string): Promise<boolean> {
  const run = await prisma.automationRun.findFirst({
    where: { leagueId, jobType: WORKSPACE_REFRESH_JOB_TYPE, status: { in: ['completed', 'skipped'] } },
    select: { id: true },
  })
  return run !== null
}

/** The automation job type that drives `reconcileLeagueTasks`. Defined here so both sides agree. */
export const WORKSPACE_REFRESH_JOB_TYPE = 'workspace.refreshTasks'
