/**
 * Deadline autopilot (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3.5) — pure rules. No prisma here;
 * `autopilotService.ts` reads the deadlines, sends, and records what it sent.
 *
 * Every deadline the league has gets a reminder at 72 h, 24 h and 1 h, to the managers who still
 * have to act. Two kinds of deadline today:
 *
 *   keeper   an open AllFantasy keeper session — only managers with no keeper submitted are told
 *   custom   a deadline the commissioner typed in (trade, taxi, franchise tag, contracts, anything,
 *            and every deadline of an imported league, whose platform's clock we cannot read) —
 *            every manager is told, because AllFantasy cannot see who has acted on it
 *
 * Tiers (spec §0: Free gets the manual version of every automation):
 *   Free         "Remind now" — the commissioner sends one reminder by hand
 *   Commissioner the automatic 72 h / 24 h / 1 h reminders
 *
 * ⚠ ONE REMINDER PER STAGE, AND ONLY THE TIGHTEST ONE DUE. A deadline added 10 hours out gets the
 * 24 h reminder once and the 1 h one later — never a 72 h "three days left" that is already false.
 * Looser stages are marked sent alongside, so they cannot fire afterwards either.
 */

export const AUTOPILOT_SETTINGS_KEY = 'deadline_autopilot'

export const STAGES = [
  { key: '72h', ms: 72 * 3600_000 },
  { key: '24h', ms: 24 * 3600_000 },
  { key: '1h', ms: 1 * 3600_000 },
] as const
export type StageKey = (typeof STAGES)[number]['key']

export const CUSTOM_KINDS = ['trade', 'taxi', 'franchise_tag', 'contract', 'keeper', 'other'] as const
export type CustomKind = (typeof CUSTOM_KINDS)[number]

export const LABEL_MAX = 80
export const CUSTOM_MAX = 20
/** A manual reminder for one deadline at most this often. */
export const MANUAL_COOLDOWN_MS = 6 * 3600_000

export type CustomDeadline = { id: string; kind: CustomKind; label: string; at: string }

export type AutopilotSettings = {
  enabled: boolean
  custom: CustomDeadline[]
  /** `${deadlineKey}:${stage}` → ISO time sent. Manual sends record under stage `manual`. */
  sent: Record<string, string>
}

export type LeagueDeadline = {
  /** Stable identity: `keeper:<sessionId>` or `custom:<id>`. */
  key: string
  kind: CustomKind
  label: string
  at: Date
  /** Who still has to act. Empty means nobody to remind. */
  recipientUserIds: string[]
  /** True when the recipients are exactly the managers who have not acted. */
  targeted: boolean
}

export type DueReminder = {
  deadline: LeagueDeadline
  stage: StageKey
  /** Every sent-marker this reminder writes: its own stage plus any looser stage it supersedes. */
  marks: string[]
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

export function readAutopilotSettings(settings: unknown): AutopilotSettings {
  const raw = asRecord(asRecord(settings)[AUTOPILOT_SETTINGS_KEY])
  const custom: CustomDeadline[] = []
  for (const row of Array.isArray(raw.custom) ? raw.custom : []) {
    const r = asRecord(row)
    const id = typeof r.id === 'string' ? r.id : null
    const label = typeof r.label === 'string' ? r.label.trim() : ''
    const at = typeof r.at === 'string' && Number.isFinite(Date.parse(r.at)) ? new Date(r.at).toISOString() : null
    const kind = (CUSTOM_KINDS as readonly string[]).includes(String(r.kind)) ? (r.kind as CustomKind) : 'other'
    if (id && label && at) custom.push({ id, kind, label: label.slice(0, LABEL_MAX), at })
  }
  const sent: Record<string, string> = {}
  for (const [k, v] of Object.entries(asRecord(raw.sent))) if (typeof v === 'string') sent[k] = v
  return { enabled: raw.enabled === true, custom: custom.sort((a, b) => a.at.localeCompare(b.at)), sent }
}

export function withAutopilotSettings(settings: unknown, next: AutopilotSettings): Record<string, unknown> {
  return { ...asRecord(settings), [AUTOPILOT_SETTINGS_KEY]: next }
}

export type CustomDeadlineInput = { id?: unknown; kind?: unknown; label?: unknown; at?: unknown }

/**
 * Validate the commissioner's list. Past deadlines are accepted (so an edit does not fail because
 * one has just gone by) and simply never remind. Ids are kept when given, so sent-markers survive
 * an edit; a new row takes `newId()`.
 */
export function parseCustomDeadlines(
  input: unknown,
  newId: () => string,
): { ok: true; custom: CustomDeadline[] } | { ok: false; error: 'too_many' | 'label_required' | 'invalid_time' } {
  const rows = Array.isArray(input) ? input : []
  if (rows.length > CUSTOM_MAX) return { ok: false, error: 'too_many' }
  const out: CustomDeadline[] = []
  for (const row of rows as CustomDeadlineInput[]) {
    const label = typeof row?.label === 'string' ? row.label.trim().slice(0, LABEL_MAX) : ''
    if (!label) return { ok: false, error: 'label_required' }
    const ms = typeof row.at === 'string' ? Date.parse(row.at) : NaN
    if (!Number.isFinite(ms)) return { ok: false, error: 'invalid_time' }
    const kind = (CUSTOM_KINDS as readonly string[]).includes(String(row.kind)) ? (row.kind as CustomKind) : 'other'
    const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim().slice(0, 64) : newId()
    out.push({ id, kind, label, at: new Date(ms).toISOString() })
  }
  return { ok: true, custom: out.sort((a, b) => a.at.localeCompare(b.at)) }
}

/** Sent-markers that no longer belong to any deadline the league has — so `sent` cannot grow forever. */
export function pruneSent(sent: Record<string, string>, liveKeys: string[]): Record<string, string> {
  const live = new Set(liveKeys)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(sent)) if (live.has(k.slice(0, k.lastIndexOf(':')))) out[k] = v
  return out
}

/** The reminders due now. Pure: the caller sends them and records `marks`. */
export function dueReminders(deadlines: LeagueDeadline[], sent: Record<string, string>, now: Date): DueReminder[] {
  const out: DueReminder[] = []
  for (const d of deadlines) {
    const left = d.at.getTime() - now.getTime()
    if (left <= 0 || d.recipientUserIds.length === 0) continue
    // The tightest stage whose window we are inside.
    let idx = -1
    for (let i = 0; i < STAGES.length; i++) if (left <= STAGES[i].ms) idx = i
    if (idx < 0) continue
    const stage = STAGES[idx]
    if (sent[`${d.key}:${stage.key}`]) continue
    out.push({ deadline: d, stage: stage.key, marks: STAGES.slice(0, idx + 1).map((s) => `${d.key}:${s.key}`) })
  }
  return out
}

/** Whether a manual "remind now" is allowed for this deadline yet. */
export function manualReminderAllowed(sent: Record<string, string>, deadlineKey: string, now: Date): boolean {
  const last = sent[`${deadlineKey}:manual`]
  return !last || now.getTime() - Date.parse(last) >= MANUAL_COOLDOWN_MS
}

function timeLeft(ms: number): string {
  const hours = Math.round(ms / 3600_000)
  if (hours >= 48) return `${Math.round(hours / 24)} days`
  if (hours >= 2) return `${hours} hours`
  const minutes = Math.max(1, Math.round(ms / 60_000))
  return minutes >= 60 ? 'about an hour' : `${minutes} minutes`
}

/** Notification title and body for one reminder. */
export function reminderCopy(d: LeagueDeadline, now: Date, leagueName: string): { title: string; body: string } {
  const left = timeLeft(d.at.getTime() - now.getTime())
  const title = `${d.label} — ${left} left`
  const body =
    d.kind === 'keeper' && d.targeted
      ? `${leagueName}: you haven't submitted keepers yet. Picks lock at the deadline, then the league's missed-deadline rule applies.`
      : `${leagueName}: ${d.label} is in ${left}. Get anything you need done before then.`
  return { title, body }
}
