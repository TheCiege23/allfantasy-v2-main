/**
 * Commissioner Hub — the audit timeline (brief item 6).
 *
 * Imports, syncs, rule changes, commissioner actions, announcements and
 * automation results, merged into one newest-first list.
 *
 * ⚠ THE RECORD IS SPREAD OVER SIX TABLES, AND SOME OF THEM WRITE THE SAME EVENT
 * TWICE. Which source each family is read from, and why:
 *
 *   imports        `import_runs`           (`league_events.import_completed` is
 *                                           the same import again — skipped)
 *   syncs          `sync_job_runs`         keyed by `<provider>:<platformLeagueId>:<season>`
 *   rule changes   `audit_logs` settings_patch, and `event_audit_feed`
 *                  governance.settings.changed — the second settings path writes
 *                  ONLY that event (`league_events.settings_changed` duplicates
 *                  the first path — skipped)
 *   commissioner   `audit_logs`, every other action type
 *   announcements  `league_chat_messages` type 'broadcast' — the broadcast route
 *                  writes no audit row at all, so the chat message IS the record
 *   automation     `automation_runs` for this league
 *
 * ⚠ `event_audit_feed` IS UP TO SIX HOURS BEHIND (it is fed by a relay), so it
 * is used only for the one event nothing else records.
 *
 * Client-safe: the mappers take plain rows; `lib/core-app/commissioner/reports.ts`
 * does the reading.
 */

export type TimelineKind = 'import' | 'sync' | 'rules' | 'commissioner' | 'announcement' | 'automation'

export type TimelineEntry = {
  id: string
  kind: TimelineKind
  at: string
  title: string
  detail: string | null
  actor: string | null
  tone: 'good' | 'warn' | 'bad' | 'neutral'
}

export const TIMELINE_KIND_LABEL: Record<TimelineKind, string> = {
  import: 'Import',
  sync: 'Sync',
  rules: 'Rule change',
  commissioner: 'Commissioner',
  announcement: 'Announcement',
  automation: 'Automation',
}

function humanize(s: string): string {
  const t = s.replace(/[._:]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function clip(s: string, n = 140): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

function statusTone(status: string): TimelineEntry['tone'] {
  const s = status.toLowerCase()
  if (s === 'completed' || s === 'success' || s === 'succeeded' || s === 'ok') return 'good'
  if (s === 'failed' || s === 'error') return 'bad'
  if (s === 'partial' || s === 'skipped' || s === 'running' || s === 'warning') return 'warn'
  return 'neutral'
}

// ── Row mappers ─────────────────────────────────────────────────────────────

export type ImportRunRow = {
  id: string
  provider: string
  season: number
  status: string
  error: string | null
  startedAt: Date
  completedAt: Date | null
}

export function fromImportRun(r: ImportRunRow, providerLabel: string): TimelineEntry {
  const tone = statusTone(r.status)
  return {
    id: `import:${r.id}`,
    kind: 'import',
    at: (r.completedAt ?? r.startedAt).toISOString(),
    title:
      tone === 'bad'
        ? `Import of the ${r.season} season failed`
        : tone === 'good'
          ? `Imported the ${r.season} season from ${providerLabel}`
          : `Import of the ${r.season} season: ${r.status}`,
    detail: tone === 'bad' && r.error ? 'The import stopped before finishing. Re-run it from the league’s sync page.' : null,
    actor: null,
    tone,
  }
}

export type SyncRunRow = {
  id: string
  status: string
  rowsWritten: number
  errorMessage: string | null
  startedAt: Date
  completedAt: Date | null
}

export function fromSyncRun(r: SyncRunRow, providerLabel: string): TimelineEntry {
  const tone = statusTone(r.status)
  return {
    id: `sync:${r.id}`,
    kind: 'sync',
    at: (r.completedAt ?? r.startedAt).toISOString(),
    title: tone === 'bad' ? `Sync from ${providerLabel} failed` : `Synced from ${providerLabel}`,
    detail:
      tone === 'bad'
        ? 'AllFantasy could not read the league on this pass; it retries automatically.'
        : r.rowsWritten > 0
          ? `${r.rowsWritten.toLocaleString('en-US')} ${r.rowsWritten === 1 ? 'record' : 'records'} updated.`
          : 'Nothing had changed.',
    actor: null,
    tone,
  }
}

export type AuditLogRow = {
  id: string
  actionType: string
  entityType: string
  metadata: unknown
  createdAt: Date
  actorName: string | null
}

/**
 * Wording for action types written today (grep `actionType:` under `server/`
 * and `lib/`). Anything else is humanized from its key rather than hidden.
 */
const ACTION_WORDING: Record<string, string> = {
  settings_patch: 'Changed league settings',
  commissioner_undo_draft_pick: 'Undid a draft pick',
  commissioner_run_waivers: 'Ran waivers by hand',
  commissioner_automation_run: 'Ran a league automation',
  commissioner_edit_standings: 'Edited the standings',
  commissioner_edit_faab: 'Adjusted a team’s FAAB',
  commissioner_edit_waiver_priority: 'Changed the waiver order',
  commissioner_recompute_standings: 'Recalculated the standings',
  league_lock_toggle: 'Locked or unlocked the league',
  emergency_pause_toggle: 'Paused or resumed the league',
  lifecycle_transition: 'Moved the league to a new season stage',
  trade_reversal_out: 'Reversed a trade',
  post_recap: 'Posted a recap',
  season_snapshot_created: 'Saved a season snapshot',
}

export function fromAuditLog(r: AuditLogRow): TimelineEntry {
  const isSettings = r.actionType === 'settings_patch'
  const meta = r.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : {}
  const fields = Array.isArray(meta.updatedFields)
    ? meta.updatedFields.filter((f): f is string => typeof f === 'string')
    : []
  return {
    id: `audit:${r.id}`,
    kind: isSettings ? 'rules' : 'commissioner',
    at: r.createdAt.toISOString(),
    title: ACTION_WORDING[r.actionType] ?? humanize(r.actionType),
    detail:
      isSettings && fields.length > 0
        ? `Updated ${fields.slice(0, 5).map(humanize).join(', ')}${fields.length > 5 ? ` and ${fields.length - 5} more` : ''}.`
        : isSettings
          ? null
          : humanize(r.entityType),
    actor: r.actorName,
    tone: 'neutral',
  }
}

export type FeedEventRow = {
  id: string
  type: string
  summary: string
  actorType: string | null
  occurredAt: Date
}

export function fromFeedEvent(r: FeedEventRow): TimelineEntry {
  return {
    id: `feed:${r.id}`,
    kind: 'rules',
    at: r.occurredAt.toISOString(),
    title: 'Changed league settings',
    detail: r.summary ? clip(r.summary) : null,
    actor: r.actorType === 'system' ? 'System' : null,
    tone: 'neutral',
  }
}

export type BroadcastRow = { id: string; message: string; createdAt: Date; actorName: string | null }

export function fromBroadcast(r: BroadcastRow): TimelineEntry {
  return {
    id: `broadcast:${r.id}`,
    kind: 'announcement',
    at: r.createdAt.toISOString(),
    title: 'Sent an @everyone announcement',
    detail: clip(r.message),
    actor: r.actorName,
    tone: 'neutral',
  }
}

export type AutomationRunRow = {
  id: string
  jobType: string
  status: string
  startedAt: Date
  finishedAt: Date | null
  metadata: unknown
}

const JOB_WORDING: Record<string, string> = {
  'workspace.refreshTasks': 'Checked the league for commissioner tasks',
  'waivers.processLeague': 'Processed waiver claims',
  'reports.generateScheduled': 'Built the scheduled commissioner report',
  'commissioner.recipes': 'Ran automation recipes',
}

function workspaceSummary(meta: Record<string, unknown>): string | null {
  const n = (k: string) => (typeof meta[k] === 'number' ? (meta[k] as number) : null)
  const opened = n('opened')
  const resolved = n('autoResolved')
  const detected = n('detected')
  if (opened == null && resolved == null) return null
  const parts: string[] = []
  if (opened) parts.push(`${opened} new ${opened === 1 ? 'task' : 'tasks'}`)
  if (resolved) parts.push(`${resolved} resolved on ${resolved === 1 ? 'its' : 'their'} own`)
  if (parts.length === 0) return detected ? `No change — ${detected} still open.` : 'Nothing needed attention.'
  return `${parts.join(', ')}.`
}

export function fromAutomationRun(r: AutomationRunRow): TimelineEntry {
  const meta = r.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : {}
  const message =
    typeof meta.resultMessage === 'string'
      ? meta.resultMessage
      : r.jobType === 'workspace.refreshTasks'
        ? workspaceSummary(meta)
        : null
  return {
    id: `automation:${r.id}`,
    kind: 'automation',
    at: (r.finishedAt ?? r.startedAt).toISOString(),
    title: JOB_WORDING[r.jobType] ?? humanize(r.jobType),
    detail: message ? clip(message) : r.status === 'skipped' ? 'Skipped — nothing was due.' : null,
    actor: 'Automation',
    tone: statusTone(r.status),
  }
}

// ── Merge ───────────────────────────────────────────────────────────────────

export function mergeTimeline(entries: TimelineEntry[], limit = 40): TimelineEntry[] {
  const seen = new Set<string>()
  return entries
    .filter((e) => {
      if (seen.has(e.id)) return false
      seen.add(e.id)
      return Number.isFinite(Date.parse(e.at))
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit)
}

/**
 * Sync runs every thirty minutes, so a raw list is mostly "Synced — nothing had
 * changed". Consecutive uneventful syncs collapse into the newest one, which
 * keeps the timeline about things that happened.
 */
export function collapseQuietSyncs(entries: TimelineEntry[]): TimelineEntry[] {
  const out: TimelineEntry[] = []
  let quietRun = 0
  for (const e of entries) {
    const quiet = e.kind === 'sync' && e.tone === 'good' && e.detail === 'Nothing had changed.'
    if (quiet) {
      quietRun += 1
      if (quietRun === 1) out.push(e)
      else {
        const head = out[out.length - 1]
        out[out.length - 1] = { ...head, detail: `Nothing had changed · ${quietRun} checks.` }
      }
      continue
    }
    quietRun = 0
    out.push(e)
  }
  return out
}
