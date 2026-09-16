/**
 * Commissioner Hub — the task cards (brief items 1 and 10).
 *
 * The first thing on the screen, on every width: what needs the commissioner,
 * worst first, each with the one action that deals with it. Reports and tables
 * come after.
 *
 * Four inputs, merged rather than stacked:
 *
 *   issues      the shell's outstanding issues for this league (draft soon,
 *               stale sync) — the same list the nav badge counts
 *   flags       the measured health flags that are not green
 *   calendar    anything dated in the next seven days
 *   workspace   Commissioner Workspace findings the daily scan opened
 *
 * ⚠ THE WORKSPACE SCAN AND THE FLAGS DETECT SOME OF THE SAME CONDITIONS, and a
 * card per detector would show one idle manager twice. Where a flag covers a
 * workspace finding, the flag's card wins (it names the teams); the workspace's
 * stale-data finding yields to the shell's stale-sync issue for the same reason.
 *
 * Client-safe: no Prisma.
 */

import type { CoreIssue } from '@/lib/core-app/outstandingIssues'
import type { CalendarEvent } from './calendar'
import type { HealthFlag } from './health'

export type TaskCard = {
  id: string
  severity: 'bad' | 'warn' | 'info'
  source: 'issue' | 'health' | 'deadline' | 'workspace'
  title: string
  detail: string
  due: string | null
  action: { label: string; href: string; external: boolean } | null
}

export type WorkspaceFinding = {
  id: string
  sourceKey: string
  title: string
  description: string
  priority: string
  dueAt: Date | null
  href: string | null
}

export type TaskCardsResult = {
  cards: TaskCard[]
  /** Cards past the limit. Rendered behind a disclosure — never silently dropped. */
  overflow: TaskCard[]
}

const RANK: Record<TaskCard['severity'], number> = { bad: 0, warn: 1, info: 2 }

/**
 * Workspace detectors whose condition the hub already answers.
 *
 * ⚠ KEYED ON THE FLAG BEING MEASURED, NOT ON IT BEING RED. The Workspace scan runs
 * daily on a rotation, so its stored finding can be days older than the hub's live
 * read of the same moves. When the hub has measured abandoned teams itself — found
 * some or found none — its answer is the fresher one, and showing the stored card
 * beside a green flag put "every team is active" and "2 managers inactive" on one
 * screen.
 */
type Coverage = { flags: Set<string>; measured: Set<string>; issueIds: Set<string>; staleCard: boolean }
const COVERED_BY: Record<string, (ctx: Coverage) => boolean> = {
  'inactive-managers:v1': ({ measured }) => measured.has('abandoned'),
  'orphan-teams:v1': ({ measured }) => measured.has('abandoned'),
  'data-stale:v1': ({ issueIds, staleCard }) => staleCard || [...issueIds].some((id) => id.endsWith(':stale')),
}

function workspaceSeverity(priority: string): TaskCard['severity'] {
  if (priority === 'critical') return 'bad'
  if (priority === 'elevated') return 'warn'
  return 'info'
}

export function buildTaskCards(input: {
  issues: CoreIssue[]
  flags: HealthFlag[]
  calendar: CalendarEvent[]
  workspace: WorkspaceFinding[]
  /**
   * This league's data is older than the activity checks can trust. The shell's
   * own stale-sync issue folds every stale league into ONE row with no league id
   * once several are stale, so the per-league hub would otherwise show nothing —
   * while its health flags all point at a re-sync. Ignored when the shell already
   * supplied a stale issue for this league.
   */
  staleSync?: { days: number; href: string; platformLabel: string } | null
  limit?: number
}): TaskCardsResult {
  const limit = input.limit ?? 6
  const cards: Array<TaskCard & { sortAt: number }> = []
  // Finite on purpose: Infinity - Infinity is NaN, which makes the sort comparator lie.
  const far = Number.MAX_SAFE_INTEGER

  for (const i of input.issues) {
    cards.push({
      id: `issue:${i.id}`,
      severity: i.severity,
      source: 'issue',
      title: i.title,
      detail: i.meta,
      due: null,
      action: i.action,
      sortAt: i.deadline ? i.deadline.getTime() : far,
    })
  }

  let staleCard = false
  if (input.staleSync && !input.issues.some((i) => i.id.endsWith(':stale'))) {
    staleCard = true
    const { days, href, platformLabel } = input.staleSync
    cards.push({
      id: 'stale-sync',
      severity: days > 7 ? 'bad' : 'warn',
      source: 'issue',
      title: `This league’s data is ${days} days old`,
      detail: `AllFantasy hasn’t read it from ${platformLabel} since then, so activity, lineups and inactive managers can’t be checked.`,
      due: null,
      action: { label: 'Re-sync', href, external: false },
      sortAt: 0,
    })
  }

  /*
   * A vote closing this week gets its own deadline card with the time on it. The
   * unresolved-votes flag says the same thing without the time, so it steps aside
   * whenever every open vote already has a deadline card.
   */
  const voteDeadlines = input.calendar.filter((e) => e.kind === 'vote' && e.status === 'soon').length

  const flagged = new Set<string>()
  const measured = new Set(input.flags.filter((f) => f.measured).map((f) => f.key))
  for (const f of input.flags) {
    if (!f.measured || f.severity === 'good') continue
    if (f.key === 'votes' && f.count <= voteDeadlines) {
      flagged.add(f.key)
      continue
    }
    flagged.add(f.key)
    cards.push({
      id: `flag:${f.key}`,
      severity: f.severity,
      source: 'health',
      title: f.headline,
      detail: f.detail,
      due: null,
      action: f.action,
      sortAt: far,
    })
  }

  for (const e of input.calendar) {
    if (e.status !== 'soon') continue
    // Dues carry no date and have their own health flag. A weekly waiver run is a
    // rhythm, not a task — a card for it would sit on the screen every week.
    if (e.kind === 'dues' || e.kind === 'waivers') continue
    cards.push({
      id: `deadline:${e.id}`,
      severity: e.kind === 'renewal' ? 'warn' : 'info',
      source: 'deadline',
      title: e.title,
      detail: e.detail,
      due: e.whenLabel,
      action: { label: 'See calendar', href: '#ch-calendar', external: false },
      sortAt: e.at ? Date.parse(e.at) : far,
    })
  }

  const issueIds = new Set(input.issues.map((i) => i.id))
  for (const w of input.workspace) {
    const covered = COVERED_BY[w.sourceKey]
    if (covered && covered({ flags: flagged, measured, issueIds, staleCard })) continue
    cards.push({
      id: `workspace:${w.id}`,
      severity: workspaceSeverity(w.priority),
      source: 'workspace',
      title: w.title,
      detail: w.description,
      due: null,
      action: w.href ? { label: 'Open', href: w.href, external: false } : null,
      sortAt: w.dueAt ? w.dueAt.getTime() : far,
    })
  }

  cards.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.sortAt - b.sortAt)
  const clean = cards.map(({ sortAt: _sortAt, ...card }) => card)
  return { cards: clean.slice(0, limit), overflow: clean.slice(limit) }
}
