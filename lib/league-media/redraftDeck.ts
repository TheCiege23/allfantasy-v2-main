/**
 * Redraft broadcast deck (batch A3): the pure mappings behind the redraft Commissioner tab's health
 * panel — score ring, sub-score bars, the season-aware checklist and the managers to check on.
 *
 * Client-safe (no Prisma, no fetch), so every rule here is testable without a database.
 *
 * ⚠ NOTHING HERE MAKES A NUMBER UP. Every function takes what a real read returned and either maps
 * it or drops it:
 *   - the score is the canonical hub score (`getCommissionerHubHealthForUser` →
 *     `resolveHubHealthScore`, the same number /core's Commissioner hub shows) or it is withheld with
 *     that resolver's own reason;
 *   - the trend line needs a series of PAST SCORES, and nothing stores one today — the engine's
 *     `healthTrend` word is computed from `previousSeasonHealthScore`, which no caller supplies, so it
 *     reads "stable" by default. Showing that word, or drawing a line through one point, would be an
 *     invented trend. `healthTrendLine` returns null below two points and the ring renders alone;
 *   - a sub-score with no value (participation is `null` on a league the engine could not count) is
 *     dropped, never drawn at 0;
 *   - checklist items come from `/api/commissioner/leagues/[id]/weekly-checklist`
 *     (lib/commissioner/weeklyChecklist.ts) — which already drops what it cannot measure — plus a
 *     trade-deadline countdown from the league row's own `tradeDeadlineWeek` and current week;
 *   - managers come from `getLeagueManagerHealth`'s rows, the per-manager read /core's member activity
 *     uses for a native league, with empty seats and the viewer's own team left out.
 */
import type { ChecklistItem, ChecklistStatus } from '@/lib/commissioner/weeklyChecklist'

/* ── Score ring ──────────────────────────────────────────────────────────────────────────────────── */

/** The ring is r=62 in a 150 viewBox (the approved mock); the arc length is its circumference. */
export const HEALTH_RING_RADIUS = 62
export const HEALTH_RING_CIRCUMFERENCE = 2 * Math.PI * HEALTH_RING_RADIUS

export type HealthTone = 'good' | 'warn' | 'bad'

/** The same bands /core's hub tile uses (70 / 45), so the two never colour one score differently. */
export function healthTone(score: number): HealthTone {
  if (score >= 70) return 'good'
  if (score >= 45) return 'warn'
  return 'bad'
}

/** `stroke-dasharray` for a 0–100 score: the filled arc, then the rest of the circle. */
export function healthRingDash(score: number): string {
  const s = Math.max(0, Math.min(100, score))
  const filled = (HEALTH_RING_CIRCUMFERENCE * s) / 100
  return `${filled.toFixed(1)} ${HEALTH_RING_CIRCUMFERENCE.toFixed(1)}`
}

export const HEALTH_STATUS_LABEL: Record<string, string> = {
  excellent: 'Excellent',
  healthy: 'Healthy',
  watch: 'Worth watching',
  at_risk: 'At risk',
  critical: 'Critical',
}

export function healthStatusLabel(status: string | null | undefined): string {
  const key = String(status ?? '').trim().toLowerCase()
  return HEALTH_STATUS_LABEL[key] ?? (key ? key.replace(/_/g, ' ') : 'Unscored')
}

/**
 * A trend line through PAST scores, oldest first. Null when there are fewer than two — one point is
 * not a trend, and no point is not a flat line. Coordinates are in a `width × height` viewBox with a
 * 6px inset so the end dot is never clipped.
 */
export function healthTrendLine(
  history: ReadonlyArray<number> | null | undefined,
  width = 372,
  height = 70,
): { points: string; last: { x: number; y: number }; first: number; latest: number } | null {
  const pts = (history ?? []).filter((n) => Number.isFinite(n))
  if (pts.length < 2) return null
  const inset = 6
  const step = (width - inset * 2) / (pts.length - 1)
  const y = (v: number) => inset + ((100 - Math.max(0, Math.min(100, v))) / 100) * (height - inset * 2)
  const coords = pts.map((v, i) => ({ x: inset + i * step, y: y(v) }))
  return {
    points: coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' '),
    last: coords[coords.length - 1],
    first: pts[0],
    latest: pts[pts.length - 1],
  }
}

/* ── Sub-scores ──────────────────────────────────────────────────────────────────────────────────── */

export type HealthSubScores = {
  /** `engagementScore` — throughput. Labelled "Activity" everywhere it is shown (6.1). */
  activity: number | null
  /** `participation.score` — people still playing. Null when the engine could not count them. */
  participation: number | null
  fairness: number | null
  sustainability: number | null
}

export type HealthSubScoreBar = { key: keyof HealthSubScores; label: string; value: number }

const SUB_SCORE_LABEL: Record<keyof HealthSubScores, string> = {
  activity: 'Activity',
  participation: 'Participation',
  fairness: 'Fairness',
  sustainability: 'Sustainability',
}

/** Bars for the sub-scores that have a value, rounded and clamped; a missing one is dropped. */
export function healthSubScoreBars(sub: Partial<HealthSubScores> | null | undefined): HealthSubScoreBar[] {
  if (!sub) return []
  return (Object.keys(SUB_SCORE_LABEL) as Array<keyof HealthSubScores>)
    .map((key) => ({ key, raw: sub[key] }))
    .filter((x): x is { key: keyof HealthSubScores; raw: number } => typeof x.raw === 'number' && Number.isFinite(x.raw))
    .map(({ key, raw }) => ({ key, label: SUB_SCORE_LABEL[key], value: Math.round(Math.max(0, Math.min(100, raw))) }))
}

/* ── The route's payload ─────────────────────────────────────────────────────────────────────────── */

export type CommishHealthScore =
  | {
      available: true
      score: number
      status: string
      summary: string
      confidencePct: number
      activeManagers: number | null
      totalManagers: number | null
      sub: HealthSubScores
      /** Past scores, oldest first. Empty today — nothing stores a score history yet. */
      history: number[]
    }
  | { available: false; reason: string }

export type CommishManagerRow = {
  rosterId: string
  managerName: string | null
  teamName: string | null
  lineupsSet: number | null
  expectedStarters: number | null
  lastActionAt: string | null
  status: 'active' | 'at_risk' | 'inactive' | 'unknown'
}

export type CommishHealthSummary = {
  score: CommishHealthScore
  /** Managers the commissioner should check on — already filtered by `managersToCheck`. */
  managers: CommishManagerCard[]
  /**
   * False when there were no manager rows to judge (no rosters read). An empty `managers` list then
   * means "could not tell", not "everyone is active", and the panel must say which.
   */
  managersRead: boolean
}

/* ── Managers to check on ────────────────────────────────────────────────────────────────────────── */

export type CommishManagerCard = {
  rosterId: string
  name: string
  initials: string
  status: 'at_risk' | 'inactive'
  /** Each a counted fact; the card shows them joined. Never empty. */
  issues: string[]
}

const DAY_MS = 86_400_000

export function initialsFor(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/**
 * Managers worth a word: `inactive` and `at_risk` rows only (`unknown` is "we could not read it",
 * which is not an accusation). Empty seats are the invite prompt's job and the viewer is never told
 * to message themselves — `excludeNames` carries both, matched on team or manager name exactly as
 * /core's `quietManagerNames` does. Inactive first, then the longest idle.
 */
export function managersToCheck(
  rows: ReadonlyArray<CommishManagerRow>,
  excludeNames: ReadonlyArray<string>,
  now: Date,
): CommishManagerCard[] {
  const skip = new Set(excludeNames.map((n) => n.trim()).filter(Boolean))
  return rows
    .filter((r) => r.status === 'inactive' || r.status === 'at_risk')
    .filter((r) => !(r.teamName && skip.has(r.teamName.trim())) && !(r.managerName && skip.has(r.managerName.trim())))
    .map((r) => {
      const issues: string[] = []
      if (r.lineupsSet != null && r.expectedStarters != null && r.expectedStarters > r.lineupsSet) {
        const empty = r.expectedStarters - r.lineupsSet
        issues.push(`${empty} empty starter${empty === 1 ? '' : 's'}`)
      }
      const last = r.lastActionAt ? Date.parse(r.lastActionAt) : NaN
      const idleDays = Number.isFinite(last) ? Math.floor((now.getTime() - last) / DAY_MS) : null
      if (idleDays != null && idleDays >= 1) issues.push(`No roster move in ${idleDays} day${idleDays === 1 ? '' : 's'}`)
      if (issues.length === 0) issues.push(r.status === 'inactive' ? 'Inactive' : 'Slowing down')
      const name = (r.teamName || r.managerName || 'Unnamed team').trim()
      return { rosterId: r.rosterId, name, initials: initialsFor(name), status: r.status as 'at_risk' | 'inactive', issues, idleDays }
    })
    .sort((a, b) => (a.status === b.status ? (b.idleDays ?? -1) - (a.idleDays ?? -1) : a.status === 'inactive' ? -1 : 1))
    .map(({ idleDays: _idle, ...card }) => card)
}

/* ── This week's checklist ───────────────────────────────────────────────────────────────────────── */

export type WeeklyChecklistResponse =
  | { applies: false; reason: 'not_redraft' | 'no_season' | 'not_in_season' }
  | { applies: true; week: number; items: ChecklistItem[] }

export type CommishCheck = {
  id: string
  status: ChecklistStatus
  title: string
  detail: string | null
  meta: string | null
  href: string | null
}

/**
 * The checklist the panel draws: the weekly checklist's own items (in its order — the order a week
 * runs), plus a trade-deadline countdown the weekly list only raises in the final two weeks.
 *
 *   in season, checklist read  → its items, then the countdown when the deadline is further out
 *   checklist not applicable   → only the countdown, when the league row has both numbers
 *   nothing readable           → [] (the panel says why, it does not draw an empty list)
 */
export function buildCommishChecklist(input: {
  checklist: WeeklyChecklistResponse | null
  currentWeek: number | null | undefined
  tradeDeadlineWeek: number | null | undefined
  language?: string
}): CommishCheck[] {
  const es = input.language === 'es'
  const out: CommishCheck[] = []
  const applied = input.checklist && input.checklist.applies ? input.checklist : null
  if (applied) {
    for (const item of applied.items) {
      out.push({
        id: item.id,
        status: item.status,
        title: es ? item.title.es : item.title.en,
        detail: (es ? item.detail.es : item.detail.en) || null,
        meta: item.id === 'trade_deadline' && input.tradeDeadlineWeek ? `${es ? 'Semana' : 'Week'} ${input.tradeDeadlineWeek}` : null,
        href: item.href || null,
      })
    }
  }
  const week = applied ? applied.week : input.currentWeek
  const deadline = input.tradeDeadlineWeek
  const hasDeadlineItem = out.some((c) => c.id === 'trade_deadline')
  if (!hasDeadlineItem && typeof week === 'number' && week >= 1 && typeof deadline === 'number' && deadline >= 1) {
    const left = deadline - week
    if (left > 1) {
      out.push({
        id: 'trade_deadline_countdown',
        status: 'heads_up',
        title: es ? `El plazo de intercambios cierra en ${left} semanas` : `Trade deadline in ${left} weeks`,
        detail: es ? 'Un recordatorio en el chat de la liga ayuda.' : 'A reminder in league chat keeps deals moving.',
        meta: `${es ? 'Semana' : 'Week'} ${deadline}`,
        href: null,
      })
    } else if (left < 0) {
      out.push({
        id: 'trade_deadline_passed',
        status: 'done',
        title: es ? 'El plazo de intercambios ya pasó' : 'Trade deadline has passed',
        detail: null,
        meta: `${es ? 'Semana' : 'Week'} ${deadline}`,
        href: null,
      })
    }
  }
  return out
}

/** Why the checklist has nothing to list, in the commissioner's words. */
export function checklistEmptyReason(checklist: WeeklyChecklistResponse | null): string {
  if (!checklist) return 'This week’s checklist could not be read right now.'
  if (checklist.applies) return 'Nothing to check this week.'
  if (checklist.reason === 'no_season' || checklist.reason === 'not_in_season') {
    return 'The weekly checklist starts once the season is under way.'
  }
  return 'The weekly checklist covers AllFantasy redraft leagues.'
}
