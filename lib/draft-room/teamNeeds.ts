/**
 * Team needs + bye-week clustering — pure helpers (Commit S).
 *
 * Pure logic only — no Prisma, no fetch, no React. Used by the war room
 * panel and any future server-side need-aware autopick weighting.
 *
 * `computeTeamNeeds`:
 *   - Driven by `starterSlots` (e.g. `{ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1 }`)
 *     so it works for IDP / DEF / K / specialty leagues without a
 *     hardcoded position list.
 *   - Returns one `TeamNeed` row per declared starter slot with
 *     `have / target / remaining / tone`.
 *   - Tone classification:
 *       * 'thin'   → starters are not yet filled
 *       * 'ok'     → starters exactly filled
 *       * 'heavy'  → drafted ≥ target + 2 (depth-overcommit signal)
 *   - Rows missing from `starterSlots` are ignored. Picks at positions
 *     not in `starterSlots` are not surfaced as needs (they may still
 *     be valid bench / FLEX picks; the consumer can layer that on).
 *
 * `detectByeWeekClusters`:
 *   - Groups drafted picks by bye week and surfaces clusters where 3 or
 *     more starters share the same bye. Empty-bye rows (`null` /
 *     `undefined`) are ignored. 3+ is the conventional fantasy
 *     threshold — enough to dent a starting lineup.
 */

import { normalizeSlotKey } from '@/lib/draft-room/rosterSlotOrder'

export type TeamNeedTone = 'thin' | 'ok' | 'heavy'

export type TeamNeed = {
  position: string
  have: number
  target: number
  remaining: number
  tone: TeamNeedTone
}

export type ByeCluster = {
  byeWeek: number
  count: number
  positions: string[]
}

type ComputeTeamNeedsInput = {
  picks: Array<{ position: string }>
  starterSlots: Record<string, number> | null | undefined
}

function normalizePosition(pos: string | null | undefined): string {
  return String(pos ?? '').trim().toUpperCase()
}

/**
 * Count drafted picks per starter-slot key. The starter-slot key may be
 * a real position ('QB') or a flex bucket ('FLEX', 'IDP_FLEX'); flex
 * buckets are intentionally NOT auto-filled here — that's a layer
 * above this helper. Consumers can layer flex satisfaction on top using
 * the returned `have` numbers.
 */
export function computeTeamNeeds(input: ComputeTeamNeedsInput): TeamNeed[] {
  const slots = input.starterSlots
  if (!slots || typeof slots !== 'object') return []
  const counts = new Map<string, number>()
  for (const p of input.picks) {
    const k = normalizePosition(p.position)
    if (!k) continue
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const out: TeamNeed[] = []
  for (const [rawSlot, rawTarget] of Object.entries(slots)) {
    const target = Number(rawTarget)
    if (!Number.isFinite(target) || target <= 0) continue
    const slot = normalizePosition(rawSlot)
    if (!slot) continue
    const have = counts.get(slot) ?? 0
    const remaining = Math.max(0, target - have)
    let tone: TeamNeedTone
    if (have >= target + 2) tone = 'heavy'
    else if (have >= target) tone = 'ok'
    else tone = 'thin'
    out.push({ position: slot, have, target, remaining, tone })
  }
  return out
}

const DISPLAY_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLX', 'SF', 'K', 'DEF', 'DL', 'LB', 'DB', 'IDP']
const FLEX_ELIGIBLE: Record<string, readonly string[]> = {
  FLX: ['RB', 'WR', 'TE'],
  SF: ['QB', 'RB', 'WR', 'TE'],
  IDP: ['DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S'],
}

/**
 * Starter needs as the War Room shows them: short slot codes (FLX, SF, DEF — never "FLEX" or
 * "SUPERFLEX"), and flex buckets FILLED from whatever overflows the fixed slots, so a superflex
 * row reads 1/1 once a second QB is drafted instead of sitting at 0/1 forever.
 *
 * Display-only on purpose: `computeTeamNeeds` also feeds waiver and decision engines that key on
 * the raw slot names, so its output is left exactly as it was.
 */
export function computeStarterNeedsForDisplay(input: ComputeTeamNeedsInput): TeamNeed[] {
  const slots = input.starterSlots
  if (!slots || typeof slots !== 'object') return []
  const targets = new Map<string, number>()
  for (const [rawSlot, rawTarget] of Object.entries(slots)) {
    const target = Math.floor(Number(rawTarget))
    if (!Number.isFinite(target) || target <= 0) continue
    const slot = normalizeSlotKey(rawSlot)
    if (!slot || slot === 'BN') continue
    targets.set(slot, (targets.get(slot) ?? 0) + target)
  }
  const counts = new Map<string, number>()
  for (const p of input.picks) {
    const k = normalizeSlotKey(normalizePosition(p.position))
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  // What is left after every fixed slot takes its starters — the pool flex rows draw from.
  const overflow = new Map<string, number>()
  for (const [pos, n] of counts) overflow.set(pos, Math.max(0, n - (targets.get(pos) ?? 0)))
  const flexFill = new Map<string, number>()
  // Narrowest bucket first, so a superflex never takes the RB a plain flex needed.
  for (const bucket of ['FLX', 'IDP', 'SF']) {
    const target = targets.get(bucket) ?? 0
    let filled = 0
    for (const pos of FLEX_ELIGIBLE[bucket]) {
      while (filled < target && (overflow.get(pos) ?? 0) > 0) {
        overflow.set(pos, (overflow.get(pos) ?? 0) - 1)
        filled += 1
      }
    }
    flexFill.set(bucket, filled)
  }
  const rank = (k: string) => {
    const i = DISPLAY_ORDER.indexOf(k)
    return i < 0 ? DISPLAY_ORDER.length : i
  }
  return [...targets.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([position, target]) => {
      const have = FLEX_ELIGIBLE[position] ? (flexFill.get(position) ?? 0) : (counts.get(position) ?? 0)
      const tone: TeamNeedTone = have >= target + 2 ? 'heavy' : have >= target ? 'ok' : 'thin'
      return { position, have, target, remaining: Math.max(0, target - have), tone }
    })
}

/**
 * Find drafted-roster bye-week clusters of 3+ players. Empty / unknown
 * byes are ignored. Returned clusters are sorted by `count` descending,
 * then byeWeek ascending so the UI surfaces the worst overlap first.
 */
export function detectByeWeekClusters(
  picks: Array<{ position: string; byeWeek?: number | null }>,
  threshold = 3,
): ByeCluster[] {
  if (!Array.isArray(picks) || picks.length === 0) return []
  const groups = new Map<number, { count: number; positions: string[] }>()
  for (const p of picks) {
    const bw = p.byeWeek
    if (bw == null || !Number.isFinite(Number(bw))) continue
    const week = Math.floor(Number(bw))
    if (week <= 0) continue
    const pos = normalizePosition(p.position) || '—'
    const entry = groups.get(week) ?? { count: 0, positions: [] }
    entry.count += 1
    entry.positions.push(pos)
    groups.set(week, entry)
  }
  const clusters: ByeCluster[] = []
  for (const [week, info] of groups.entries()) {
    if (info.count < threshold) continue
    clusters.push({
      byeWeek: week,
      count: info.count,
      positions: [...info.positions].sort(),
    })
  }
  clusters.sort((a, b) => (b.count !== a.count ? b.count - a.count : a.byeWeek - b.byeWeek))
  return clusters
}
