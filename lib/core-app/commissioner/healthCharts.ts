/**
 * Commissioner Hub — the league-health breakdown and the activity charts that sit beside it
 * (redesign, 2026-10-31).
 *
 *   healthComponents       five 0–100 bars under the health score, each with the count it came from
 *   weeklyActivitySeries   waiver claims, free-agent adds and trades per fantasy week (line chart)
 *   managerActivityRows    the same three per manager this season, with the inactive flag (stacked bars)
 *   transactionMix         this season's moves by kind (pie)
 *   engagementMix          managers by activity status (pie)
 *   pie3dGeometry          the tilted pie the owner asked for, as SVG paths
 *
 * ⚠ EVERY BAR IS A SHARE OF SOMETHING COUNTABLE, NEVER A CALIBRATED "SCORE". Lineups set is teams
 * with a full lineup out of all teams; dues is paid out of all; waiver and trade activity are
 * managers who made at least one such move this season out of the managers we can name; chat is
 * linked managers who posted in the last seven days out of linked managers. charts.ts already
 * refuses to invent a 0–100 parity number with no calibration behind it, and the same rule holds.
 *
 * ⚠ "NOT MEASURED" IS NOT ZERO. A component with nothing to read carries `value: null` and the
 * reason, so a league we have never looked at does not render as a league that is failing.
 *
 * Client-safe: no Prisma. reports.ts reads the rows; the hub's own data supplies the flags.
 */

import { fantasyWeekStart, type ActivityRow, type ManagerRef } from './charts'
import type { HealthFlag } from './health'
import type { MemberActivityRow, MemberStatus } from './activity'
import { coreLocale } from '../messages/coreLocale'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** The three moves the charts plot. Imported free-agent adds are stored as `roster_move`. */
export type MoveKind = 'waiver' | 'trade' | 'fa'

export function moveKindOf(activityType: string): MoveKind | null {
  if (activityType === 'waiver') return 'waiver'
  if (activityType === 'trade') return 'trade'
  if (activityType === 'roster_move') return 'fa'
  return null
}

// ── Health components ──────────────────────────────────────────────────────

export type HealthComponentKey = 'lineups' | 'waivers' | 'trades' | 'dues' | 'chat'

export type HealthComponent = {
  key: HealthComponentKey
  /** 0–100, rounded; null when not measured. */
  value: number | null
  /** The two counts behind the value, e.g. 9 of 12. Null when not measured. */
  part: number | null
  whole: number | null
  /** Why it is not measured. Null when it is. */
  reason: string | null
}

export type Participation = { participants: number; managers: number } | { unmeasured: string }

export type HealthComponentsInput = {
  teamCount: number
  /** The hub's own lineup and dues flags — the same verdicts the task cards use. */
  flags: HealthFlag[]
  waivers: Participation
  trades: Participation
  chat: Participation
}

function share(part: number, whole: number): number {
  return whole > 0 ? Math.round((Math.max(0, Math.min(part, whole)) / whole) * 100) : 0
}

function fromFlag(key: 'lineups' | 'dues', flag: HealthFlag | undefined, teamCount: number, missing: string): HealthComponent {
  if (!flag) return { key, value: null, part: null, whole: null, reason: missing }
  if (!flag.measured) return { key, value: null, part: null, whole: null, reason: flag.reason }
  if (teamCount <= 0) return { key, value: null, part: null, whole: null, reason: missing }
  // A flag's count is the teams with the problem (no full lineup, unpaid dues).
  const ok = Math.max(0, teamCount - flag.count)
  return { key, value: share(ok, teamCount), part: ok, whole: teamCount, reason: null }
}

function fromParticipation(key: 'waivers' | 'trades' | 'chat', p: Participation): HealthComponent {
  if ('unmeasured' in p) return { key, value: null, part: null, whole: null, reason: p.unmeasured }
  if (p.managers <= 0) return { key, value: null, part: null, whole: null, reason: '' }
  return { key, value: share(p.participants, p.managers), part: Math.min(p.participants, p.managers), whole: p.managers, reason: null }
}

/**
 * The five bars, in the order the card draws them. `missingReason` is used when a flag is absent
 * (it should not be — every hub builds both) or the league has no teams on file.
 */
export function healthComponents(input: HealthComponentsInput, missingReason: string): HealthComponent[] {
  const flag = (k: string) => input.flags.find((f) => f.key === k)
  return [
    fromFlag('lineups', flag('lineups'), input.teamCount, missingReason),
    fromParticipation('waivers', input.waivers),
    fromParticipation('trades', input.trades),
    fromFlag('dues', flag('dues'), input.teamCount, missingReason),
    fromParticipation('chat', input.chat),
  ]
}

/** Managers who made at least one move of `kind` among `rows`, out of the managers we can name. */
export function participation(rows: ActivityRow[], managers: ManagerRef[], kind: MoveKind): { participants: number; managers: number } {
  const known = new Set(managers.map((m) => m.key))
  const moved = new Set<string>()
  for (const r of rows) {
    if (moveKindOf(r.activityType) !== kind) continue
    for (const raw of r.managerKeys) {
      const key = raw.replace(/^[a-z]+:/, '')
      if (known.has(key)) moved.add(key)
    }
  }
  return { participants: moved.size, managers: known.size }
}

// ── Weekly series (line chart) ─────────────────────────────────────────────

export type WeekPoint = { start: string; label: string; waiver: number; trade: number; fa: number }

/**
 * One point per fantasy week from the season's first week to this one — at least `minWeeks`,
 * at most `maxWeeks` (the newest kept) — with the three move kinds counted separately. Rows must
 * already be deduped (charts.ts `dedupeActivity`).
 */
export function weeklyActivitySeries(
  rows: ActivityRow[],
  now: Date,
  seasonStart: Date,
  language = 'en',
  opts: { minWeeks?: number; maxWeeks?: number } = {},
): WeekPoint[] {
  const minWeeks = opts.minWeeks ?? 4
  const maxWeeks = opts.maxWeeks ?? 18
  const newest = fantasyWeekStart(now).getTime()
  const first = fantasyWeekStart(seasonStart).getTime()
  const span = Math.floor((newest - first) / WEEK_MS) + 1
  const weeks = Math.max(minWeeks, Math.min(maxWeeks, span))
  const locale = coreLocale(language).usLocale
  const points: WeekPoint[] = Array.from({ length: weeks }, (_, i) => {
    const start = new Date(newest - (weeks - 1 - i) * WEEK_MS)
    return {
      start: start.toISOString(),
      label: start.toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      waiver: 0,
      trade: 0,
      fa: 0,
    }
  })
  const firstShown = newest - (weeks - 1) * WEEK_MS
  for (const r of rows) {
    const kind = moveKindOf(r.activityType)
    if (!kind) continue
    const s = fantasyWeekStart(r.occurredAt).getTime()
    if (s < firstShown || s > newest) continue
    const idx = Math.round((s - firstShown) / WEEK_MS)
    if (idx >= 0 && idx < points.length) points[idx][kind] += 1
  }
  return points
}

// ── Per manager (stacked bars + table) ─────────────────────────────────────

export type ManagerActivity = {
  name: string
  waiver: number
  trade: number
  fa: number
  total: number
  /** From member activity — the same verdict as the abandoned-teams check. */
  status: MemberStatus | null
  lastActionAt: string | null
}

/**
 * This season's moves per named manager. Every manager is listed, including the ones with no
 * moves (they are the point of the chart), most moves first. `members` supplies status and last
 * move; a manager it does not list has status null.
 */
export function managerActivityRows(
  rows: ActivityRow[],
  managers: ManagerRef[],
  members: MemberActivityRow[] | null,
): ManagerActivity[] {
  const byKey = new Map(managers.map((m) => [m.key, m.name]))
  const counts = new Map<string, { waiver: number; trade: number; fa: number }>()
  for (const m of managers) counts.set(m.name, { waiver: 0, trade: 0, fa: 0 })
  for (const r of rows) {
    const kind = moveKindOf(r.activityType)
    if (!kind) continue
    // A trade names two managers; each made it.
    for (const raw of new Set(r.managerKeys.map((k) => k.replace(/^[a-z]+:/, '')))) {
      const name = byKey.get(raw)
      if (!name) continue
      counts.get(name)![kind] += 1
    }
  }
  const memberBy = new Map((members ?? []).map((m) => [m.name, m]))
  return managers
    .map((m) => {
      const c = counts.get(m.name)!
      const member = memberBy.get(m.name)
      return {
        name: m.name,
        ...c,
        total: c.waiver + c.trade + c.fa,
        status: member?.status ?? null,
        lastActionAt: member?.lastActionAt ?? null,
      }
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}

// ── Pies ───────────────────────────────────────────────────────────────────

export type MixSlice = { key: string; value: number; pct: number }

function withPct(slices: Array<{ key: string; value: number }>): MixSlice[] {
  const total = slices.reduce((n, s) => n + s.value, 0)
  if (total === 0) return []
  // Largest-remainder rounding, so the legend's percentages add up to exactly 100.
  const raw = slices.map((s) => (s.value / total) * 100)
  const floors = raw.map(Math.floor)
  let left = 100 - floors.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => ({ i, rem: r - floors[i] })).sort((a, b) => b.rem - a.rem)
  for (const o of order) {
    if (left <= 0) break
    if (slices[o.i].value === 0) continue
    floors[o.i] += 1
    left -= 1
  }
  return slices.map((s, i) => ({ ...s, pct: floors[i] }))
}

/** This season's moves by kind; empty when there were none. */
export function transactionMix(rows: ActivityRow[]): MixSlice[] {
  const n = { waiver: 0, trade: 0, fa: 0 }
  for (const r of rows) {
    const kind = moveKindOf(r.activityType)
    if (kind) n[kind] += 1
  }
  return withPct([
    { key: 'waiver', value: n.waiver },
    { key: 'trade', value: n.trade },
    { key: 'fa', value: n.fa },
  ])
}

/** Managers by status, in the order the legend reads; `unknown` only when there are some. */
export function engagementMix(members: MemberActivityRow[]): MixSlice[] {
  const count = (s: MemberStatus) => members.filter((m) => m.status === s).length
  const slices = [
    { key: 'active', value: count('active') },
    { key: 'at_risk', value: count('at_risk') },
    { key: 'inactive', value: count('inactive') },
  ]
  const unknown = count('unknown')
  if (unknown > 0) slices.push({ key: 'unknown', value: unknown })
  return withPct(slices)
}

/**
 * A pie tilted back into 3D: an elliptical top face per slice, plus the visible front wall
 * (angles 0..π, the half facing the reader) drawn darker beneath it. Returns SVG path data in a
 * `width × height` box. Slices start at 12 o'clock and run clockwise, in input order.
 */
export function pie3dGeometry(
  values: number[],
  opts: { cx?: number; cy?: number; rx?: number; ry?: number; depth?: number } = {},
): Array<{ top: string; side: string }> {
  const cx = opts.cx ?? 150
  const cy = opts.cy ?? 76
  const rx = opts.rx ?? 128
  const ry = opts.ry ?? 64
  const depth = opts.depth ?? 22
  const total = values.reduce((n, v) => n + Math.max(0, v), 0)
  const P = (t: number, dy = 0) => `${(cx + rx * Math.cos(t)).toFixed(2)} ${(cy + ry * Math.sin(t) + dy).toFixed(2)}`
  if (total <= 0) return values.map(() => ({ top: '', side: '' }))
  let a = -Math.PI / 2
  return values.map((raw) => {
    const v = Math.max(0, raw)
    const a0 = a
    const a1 = a + (v / total) * Math.PI * 2
    a = a1
    if (v === 0) return { top: '', side: '' }
    // A single slice is a full ellipse; an arc from a point back to itself draws nothing.
    if (v === total) {
      const top = `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx - rx} ${cy} Z`
      const side = `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy} L ${cx + rx} ${cy + depth} A ${rx} ${ry} 0 0 1 ${cx - rx} ${cy + depth} Z`
      return { top, side }
    }
    const top = `M ${cx} ${cy} L ${P(a0)} A ${rx} ${ry} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${P(a1)} Z`
    let side = ''
    for (let k = -1; k <= 1; k++) {
      const lo = Math.max(a0, 2 * Math.PI * k)
      const hi = Math.min(a1, 2 * Math.PI * k + Math.PI)
      if (hi > lo) side += `M ${P(lo)} A ${rx} ${ry} 0 0 1 ${P(hi)} L ${P(hi, depth)} A ${rx} ${ry} 0 0 0 ${P(lo, depth)} Z `
    }
    return { top, side: side.trim() }
  })
}

/** Weeks for the "Last 4 weeks" view. */
export function lastWeeks(points: WeekPoint[], n = 4): WeekPoint[] {
  return points.slice(-n)
}
