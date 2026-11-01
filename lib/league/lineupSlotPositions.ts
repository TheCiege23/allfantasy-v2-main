/**
 * Starter SLOT POSITIONS — which expanded starter slot (QB, RB1, RB2, …, FLEX) each starter holds.
 *
 * Stored inside the existing `Roster.playerData` JSON, on each starter row of
 * `lineup_sections.starters` as `slotIndex` (an index into the league's expanded starter slots, the
 * `starterSlots` GET /api/league/roster returns). No schema change: the column is JSONB and every
 * reader either ignores unknown row fields or spreads them through.
 *
 * Why: starters are stored as a COMPACTED ordered list (an empty slot is simply absent), so where a
 * hole sat was lost on save and the screen re-seated starters on load. With a FLEX slot the hole
 * moved (bench RB2 → the FLEX RB slid into RB2 and FLEX showed empty). A position per row keeps it.
 *
 * Invariants:
 *  - Positions live on STARTER rows only. Every other section has it stripped (`withoutSlotIndex`),
 *    so a player benched by any writer cannot carry a stale slot back into the lineup later.
 *  - The compacted lists (`starters`, `lineup_sections.starters` order) are unchanged, so scoring,
 *    `slotType` (a starter's slotType is his POSITION, e.g. `RB`, never a slot index) and every legacy
 *    reader see exactly what they saw before.
 *  - A lineup with no positions (saved before this, or by a writer that does not send them) reads as
 *    before: the caller re-seats it.
 */
import type { ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'

export const STARTER_SLOT_INDEX_KEY = 'slotIndex' as const

function rowObject(row: unknown): Record<string, unknown> | null {
  return row && typeof row === 'object' && !Array.isArray(row) ? (row as Record<string, unknown>) : null
}

function rowId(row: unknown): string {
  if (typeof row === 'string') return row.trim()
  const o = rowObject(row)
  return o ? String(o.id ?? o.player_id ?? '').trim() : ''
}

/** True when the row names a slot at all, valid or not. */
export function hasStarterSlotIndex(row: unknown): boolean {
  const o = rowObject(row)
  return Boolean(o && STARTER_SLOT_INDEX_KEY in o && o[STARTER_SLOT_INDEX_KEY] !== undefined && o[STARTER_SLOT_INDEX_KEY] !== null)
}

/** The row's slot index when it is a non-negative integer; anything else is no position. */
export function starterSlotIndexOf(row: unknown): number | null {
  const o = rowObject(row)
  if (!o) return null
  const v = o[STARTER_SLOT_INDEX_KEY]
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null
}

/** The row without a slot index (for every non-starter section). */
export function withoutSlotIndex<T extends Record<string, unknown>>(row: T): T {
  if (!(STARTER_SLOT_INDEX_KEY in row)) return row
  const { [STARTER_SLOT_INDEX_KEY]: _drop, ...rest } = row
  return rest as T
}

/**
 * Lay saved starter rows out over `slotCount` slots by their stored positions: each row with a
 * valid, in-range, UNIQUE slot index sits there; every other row fills the open slots in saved order
 * (so nobody is dropped). Returns `null` when no row carries a usable position — the caller then
 * falls back to the pre-positions reading (compacted, re-seated).
 */
export function placeStartersBySlotIndex(rows: readonly unknown[], slotCount: number): string[] | null {
  const n = Math.max(0, slotCount)
  const entries = rows.map((r) => ({ id: rowId(r), at: starterSlotIndexOf(r) })).filter((e) => e.id)
  const claims = new Map<number, number>()
  for (const e of entries) if (e.at != null && e.at < n) claims.set(e.at, (claims.get(e.at) ?? 0) + 1)
  const positioned = (e: { at: number | null }) => e.at != null && e.at < n && claims.get(e.at) === 1
  if (!entries.some(positioned)) return null
  const out: string[] = new Array(n).fill('')
  const rest: string[] = []
  for (const e of entries) {
    if (positioned(e)) out[e.at as number] = e.id
    else rest.push(e.id)
  }
  for (const id of rest) {
    const open = out.indexOf('')
    if (open < 0) break
    out[open] = id
  }
  return out
}

export type StarterSlotIssue = {
  code: 'starter_slot_invalid' | 'starter_slot_out_of_range' | 'starter_slot_duplicate' | 'starter_slot_ineligible'
  message: string
  section: 'starters'
  playerId?: string
}

/**
 * Server check for positioned starters, against the SAME slot layout the screen was given
 * (`resolveLineupStarterSlots`): a slot index must be a valid integer, name a real slot, be held by
 * one starter only, and the starter must be eligible for THAT slot (not merely for some starter
 * slot, which is all the template union check asks). Unpositioned rows are not checked here.
 *
 * `previous` is the stored lineup. A position carried over UNCHANGED (same player, same index) is
 * not held against the save: a writer that preserves rows (auto-subs, AI apply) must not be refused
 * because the commissioner changed the template since the manager last saved. Any new or changed
 * claim is checked in full.
 */
export function collectStarterSlotIssues(args: {
  starters: ReadonlyArray<Record<string, unknown>>
  slots: readonly ExpandedStarterSlot[]
  previousStarters?: ReadonlyArray<Record<string, unknown>>
  eligible: (slot: ExpandedStarterSlot, position: string) => boolean
}): StarterSlotIssue[] {
  const { starters, slots } = args
  const carried = new Map<string, number>()
  for (const r of args.previousStarters ?? []) {
    const at = starterSlotIndexOf(r)
    if (at != null) carried.set(rowId(r), at)
  }
  const isCarried = (id: string, at: number) => carried.get(id) === at
  const issues: StarterSlotIssue[] = []
  const holders = new Map<number, string[]>()
  for (const row of starters) {
    if (!hasStarterSlotIndex(row)) continue
    const id = rowId(row)
    const at = starterSlotIndexOf(row)
    if (at == null) {
      issues.push({ code: 'starter_slot_invalid', message: `Starter ${id} has an invalid lineup slot.`, section: 'starters', playerId: id || undefined })
      continue
    }
    holders.set(at, [...(holders.get(at) ?? []), id])
    if (isCarried(id, at)) continue
    const slot = slots[at]
    if (!slot) {
      issues.push({ code: 'starter_slot_out_of_range', message: `Starter ${id} is in a lineup slot this league does not have.`, section: 'starters', playerId: id || undefined })
      continue
    }
    if (!args.eligible(slot, String(row.position ?? ''))) {
      issues.push({
        code: 'starter_slot_ineligible',
        message: `Starter ${id} (${String(row.position ?? '?').toUpperCase()}) is not eligible for the ${slot.label} slot.`,
        section: 'starters',
        playerId: id || undefined,
      })
    }
  }
  for (const [at, ids] of holders) {
    if (ids.length < 2 || ids.every((id) => isCarried(id, at))) continue
    issues.push({
      code: 'starter_slot_duplicate',
      message: `${ids.length} starters are in the same lineup slot (${slots[at]?.label ?? at + 1}).`,
      section: 'starters',
      playerId: ids[0] || undefined,
    })
  }
  return issues
}
