/**
 * Guillotine chop schedule and immunity (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §4.5, AF Commissioner).
 *
 *   schedule    "teams chopped per week by schedule (e.g., 1/wk then 2/wk after week 10)" — steps
 *   overrides   "double-chop weeks, 'no-chop' holiday weeks" — a week set to 0, 2, 3…
 *   immunity    "weekly top scorer is chop-proof next week"
 *
 * Until now the engine took one `teamsPerChop` for the whole season. `League.guillotineAcceleratedWeeks`
 * and `guillotineEliminationsPerPeriod` were written at creation and read by nothing, so a commissioner
 * who set them got a season that ignored them. These rules live in `League.settings.guillotine_advanced`
 * and are the ones the engine reads.
 *
 * ⚠ IMMUNITY NEVER STOPS A CHOP. If protecting last week's top scorer would leave fewer teams to cut
 * than the week calls for, immunity is skipped for that week — the chop count is the rule, immunity
 * is the reward, and a reward must not break the format.
 *
 * Pure.
 */

export const ADVANCED_KEY = 'guillotine_advanced'
export const MAX_CHOPS_PER_WEEK = 4
export const MAX_WEEK = 30

export type ImmunityRule = 'off' | 'top_scorer'

export type GuillotineAdvanced = {
  /** From `fromWeek` on, `chops` teams per week (until the next step). Sorted by week. */
  steps: Array<{ fromWeek: number; chops: number }>
  /** Exact weeks: 0 = no chop (holiday), 2+ = double/triple chop. Wins over steps. */
  overrides: Record<number, number>
  immunity: ImmunityRule
}

export const DEFAULT_ADVANCED: GuillotineAdvanced = { steps: [], overrides: {}, immunity: 'off' }

const isWeek = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_WEEK
const isChops = (n: unknown, allowZero: boolean): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= (allowZero ? 0 : 1) && n <= MAX_CHOPS_PER_WEEK

export type NormalizeError = 'bad_step' | 'duplicate_step' | 'bad_override' | 'bad_immunity'

/** Validate a commissioner's input. Strict: an invalid row is an error, never silently dropped. */
export function normalizeAdvanced(raw: unknown): { ok: true; value: GuillotineAdvanced } | { ok: false; error: NormalizeError } {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const stepsIn = Array.isArray(r.steps) ? r.steps : []
  const steps: GuillotineAdvanced['steps'] = []
  for (const s of stepsIn) {
    const x = (s ?? {}) as Record<string, unknown>
    if (!isWeek(x.fromWeek) || !isChops(x.chops, false)) return { ok: false, error: 'bad_step' }
    if (steps.some((p) => p.fromWeek === x.fromWeek)) return { ok: false, error: 'duplicate_step' }
    steps.push({ fromWeek: x.fromWeek, chops: x.chops })
  }
  steps.sort((a, b) => a.fromWeek - b.fromWeek)
  const overrides: Record<number, number> = {}
  const ovIn = r.overrides && typeof r.overrides === 'object' ? (r.overrides as Record<string, unknown>) : {}
  for (const [k, v] of Object.entries(ovIn)) {
    const week = Number(k)
    if (!isWeek(week) || !isChops(v, true)) return { ok: false, error: 'bad_override' }
    overrides[week] = v
  }
  const immunity = r.immunity ?? 'off'
  if (immunity !== 'off' && immunity !== 'top_scorer') return { ok: false, error: 'bad_immunity' }
  return { ok: true, value: { steps, overrides, immunity } }
}

/** What is stored. Anything unreadable reads as the default rather than breaking a chop. */
export function readAdvanced(settings: unknown): GuillotineAdvanced {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[ADVANCED_KEY] : null
  const n = normalizeAdvanced(s)
  return n.ok ? n.value : DEFAULT_ADVANCED
}

export function isDefault(a: GuillotineAdvanced): boolean {
  return a.steps.length === 0 && Object.keys(a.overrides).length === 0 && a.immunity === 'off'
}

/** Teams this week calls for: an exact-week override, else the latest step at or before the week, else the base. */
export function scheduledChops(a: GuillotineAdvanced, week: number, base: number): number {
  if (Object.prototype.hasOwnProperty.call(a.overrides, week)) return a.overrides[week]
  let n = base
  for (const s of a.steps) if (s.fromWeek <= week) n = s.chops
  return n
}

/**
 * Last week's top scorer(s) among the teams still alive now. Ties at the top share it. None when
 * immunity is off, or last week has no scores (the first chop week).
 */
export function immuneRosterIds(a: GuillotineAdvanced, previousWeek: ReadonlyArray<{ rosterId: string; periodPoints: number }>, aliveIds: readonly string[]): string[] {
  if (a.immunity !== 'top_scorer') return []
  const alive = new Set(aliveIds)
  const rows = previousWeek.filter((r) => alive.has(r.rosterId) && Number.isFinite(r.periodPoints))
  if (rows.length === 0) return []
  const top = Math.max(...rows.map((r) => r.periodPoints))
  return rows.filter((r) => r.periodPoints === top).map((r) => r.rosterId)
}

/** Candidates for the chop with immune teams removed — unless that leaves too few to cut. */
export function applyImmunity<T extends { rosterId: string }>(candidates: readonly T[], immune: readonly string[], chopCount: number): { candidates: T[]; protectedIds: string[] } {
  if (immune.length === 0) return { candidates: [...candidates], protectedIds: [] }
  const set = new Set(immune)
  const left = candidates.filter((c) => !set.has(c.rosterId))
  if (left.length < chopCount) return { candidates: [...candidates], protectedIds: [] }
  return { candidates: left, protectedIds: candidates.filter((c) => set.has(c.rosterId)).map((c) => c.rosterId) }
}

/** Plain-words schedule for the settings page and the rules card. */
export function describeSchedule(a: GuillotineAdvanced, base: number, startWeek: number): string[] {
  const t = (n: number) => (n === 1 ? '1 team' : `${n} teams`)
  const lines = [`From week ${startWeek}: ${t(base)} a week.`]
  for (const s of a.steps) if (s.fromWeek > startWeek) lines.push(`From week ${s.fromWeek}: ${t(s.chops)} a week.`)
  for (const [w, n] of Object.entries(a.overrides).sort((x, y) => Number(x[0]) - Number(y[0]))) {
    lines.push(n === 0 ? `Week ${w}: no chop.` : `Week ${w}: ${t(n)} chopped.`)
  }
  if (a.immunity === 'top_scorer') lines.push('Each week’s top scorer cannot be chopped the next week.')
  return lines
}
