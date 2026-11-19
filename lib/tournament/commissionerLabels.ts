/**
 * Words for the codes the commissioner dashboard receives. The API returns engine codes (`in_progress`,
 * `finals`, `tradeDeadlineWeek`); a commissioner should read words. Pure, so the dashboard, the history panel
 * and the approvals list share one wording.
 */

const STATUS_LABELS: Record<string, string> = {
  in_progress: 'In progress',
  pre_draft: 'Before the draft',
  rules_published: 'Rules published',
  registration: 'Registration open',
  completed: 'Complete',
  complete: 'Complete',
}

const PHASE_LABELS: Record<string, string> = {
  qualification: 'Qualification',
  elimination: 'Elimination',
  finals: 'Finals',
}

/** `snake_case` / `camelCase` → "Sentence case". */
function humanizeCode(code: string): string {
  const words = code
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
  return words ? words[0]!.toUpperCase() + words.slice(1) : code
}

export function tournamentStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? humanizeCode(status)
}

export function roundPhaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? humanizeCode(phase)
}

function valueLabel(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'None'
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return /^[a-z][a-z0-9]*(_[a-z0-9]+)+$|^[a-z]+$/.test(value) ? humanizeCode(value) : value
  if (Array.isArray(value)) return value.map(valueLabel).join(', ')
  return 'Changed'
}

/**
 * A co-commissioner's proposed settings change as readable rows: `{ waiverType: 'rolling' }` →
 * `[{ setting: 'Waiver type', value: 'Rolling' }]`. Nested objects are flattened one level ("Scoring · Pass TD").
 */
export function describeSettingsPatch(patch: Record<string, unknown>): Array<{ setting: string; value: string }> {
  const rows: Array<{ setting: string; value: string }> = []
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [inner, innerValue] of Object.entries(value as Record<string, unknown>)) {
        rows.push({ setting: `${humanizeCode(key)} · ${humanizeCode(inner)}`, value: valueLabel(innerValue) })
      }
    } else {
      rows.push({ setting: humanizeCode(key), value: valueLabel(value) })
    }
  }
  return rows
}
