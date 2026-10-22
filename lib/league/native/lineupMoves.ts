/**
 * Lineup move rules for the native lineup screen, shared by its click ("Move") and drag-and-drop
 * flows so both decide eligibility the same way. Slot eligibility is `playerEligibleForSlot` — the
 * same check the Team tab's swap candidates use — and the list edit for a slot is `applyLineupPick`.
 * Sport-agnostic: NFL, NBA, NHL and MLB differ only in their expanded slot templates.
 *
 * This only PROPOSES the next lists. The save route revalidates every one of them (template, IR
 * status, locks) and remains the authority.
 */
import type { ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'
import { applyLineupPick, playerEligibleForSlot, type RosterLineupLists } from '@/lib/league/lineup-swap'

export type LineupSpot = { kind: 'starter'; slotIndex: number } | { kind: 'bench' } | { kind: 'ir' }

export type LineupMoveContext = {
  lists: RosterLineupLists
  slots: ExpandedStarterSlot[]
  positionOf: (playerId: string) => string | null | undefined
  isLocked: (playerId: string) => boolean
  lockReason?: (playerId: string) => string | undefined
  /** Whether this player's injury designation qualifies for IR under the league's rules. */
  canIr: (playerId: string) => boolean
  /** Section capacities when the server reported them; a missing limit is left to the server. */
  limits?: { bench?: number | null; ir?: number | null } | null
}

/** `noop` marks a drop back where the player already is: not an error, nothing to say. */
export type LineupMoveResult = { ok: true; next: RosterLineupLists } | { ok: false; reason: string; noop?: true }

export function locatePlayer(lists: RosterLineupLists, playerId: string): LineupSpot | null {
  if (!playerId) return null
  const si = lists.starters.indexOf(playerId)
  if (si >= 0) return { kind: 'starter', slotIndex: si }
  if (lists.bench.includes(playerId)) return { kind: 'bench' }
  if (lists.ir.includes(playerId)) return { kind: 'ir' }
  return null
}

const copy = (l: RosterLineupLists): RosterLineupLists => ({
  starters: [...l.starters],
  bench: [...l.bench],
  ir: [...l.ir],
  taxi: [...l.taxi],
  devy: [...l.devy],
})
const count = (ids: string[]) => ids.filter(Boolean).length
const lockedMsg = (ctx: LineupMoveContext, id: string) => ctx.lockReason?.(id) || 'This player is locked.'

/** Removes `id` from wherever it sits: a starting slot is left EMPTY, a list entry is dropped. */
function lift(l: RosterLineupLists, id: string): RosterLineupLists {
  const n = copy(l)
  n.starters = n.starters.map((x) => (x === id ? '' : x))
  n.bench = n.bench.filter((x) => x !== id)
  n.ir = n.ir.filter((x) => x !== id)
  return n
}

export function resolveLineupMove(ctx: LineupMoveContext, playerId: string, target: LineupSpot): LineupMoveResult {
  const { lists, slots } = ctx
  const from = locatePlayer(lists, playerId)
  if (!from) return { ok: false, reason: 'That player is not on this lineup.' }
  if (ctx.isLocked(playerId)) return { ok: false, reason: lockedMsg(ctx, playerId) }
  if (from.kind === target.kind && (from.kind !== 'starter' || (target.kind === 'starter' && from.slotIndex === target.slotIndex))) {
    return { ok: false, reason: 'Already there.', noop: true }
  }

  if (target.kind === 'starter') {
    const slot = slots[target.slotIndex]
    if (!slot) return { ok: false, reason: 'That slot does not exist.' }
    if (from.kind === 'ir') return { ok: false, reason: 'Move him from IR to the bench first.' }
    if (!playerEligibleForSlot(slot, ctx.positionOf(playerId))) return { ok: false, reason: `Not eligible for ${slot.label}.` }
    const occupant = lists.starters[target.slotIndex] ?? ''
    if (occupant && ctx.isLocked(occupant)) return { ok: false, reason: lockedMsg(ctx, occupant) }
    // Starter ↔ starter: the displaced player takes the vacated slot, so he must be able to fill it.
    if (occupant && from.kind === 'starter') {
      const back = slots[from.slotIndex]
      if (back && !playerEligibleForSlot(back, ctx.positionOf(occupant))) {
        return { ok: false, reason: `The player in ${slot.label} is not eligible for ${back.label}.` }
      }
    }
    // From the bench, applyLineupPick benches the occupant: the bench count is unchanged.
    return { ok: true, next: applyLineupPick({ lists, slotIndex: target.slotIndex, incomingId: playerId }) }
  }

  if (target.kind === 'bench') {
    const max = ctx.limits?.bench
    if (max != null && count(lists.bench) >= max) return { ok: false, reason: 'Your bench is full.' }
    const n = lift(lists, playerId)
    n.bench.push(playerId)
    return { ok: true, next: n }
  }

  // target.kind === 'ir'
  const maxIr = ctx.limits?.ir
  if (maxIr != null && maxIr <= 0) return { ok: false, reason: 'This league has no IR slots.' }
  if (!ctx.canIr(playerId)) return { ok: false, reason: 'Only players with an IR-eligible designation can go on IR.' }
  if (maxIr != null && count(lists.ir) >= maxIr) return { ok: false, reason: 'Your IR is full.' }
  const n = lift(lists, playerId)
  n.ir.push(playerId)
  return { ok: true, next: n }
}

/**
 * A lineup saved WITH slot positions (lib/league/lineupSlotPositions.ts) is read back slot-for-slot by
 * `buildLineupListsFromPlayerData`, and this returns it unchanged — every starter is eligible at his
 * own index. It is the fallback for a lineup saved WITHOUT them (before positions, or by another
 * writer): those are stored as an ORDERED, COMPACTED list (an empty slot is simply absent) and padded
 * at the end, so a hole comes back with every later starter shifted one slot up — a WR in the RB
 * slot. This re-seats the starters into
 * slots they are eligible for: each keeps its own index when eligible there, otherwise takes the
 * first eligible open slot (with augmenting moves, so a maximal set is seated). A starter that
 * cannot be placed anywhere (no position data) keeps an open slot in order, so nobody is dropped.
 * A lineup already in slot order is returned unchanged.
 */
export function seatStartersInSlots(
  starters: string[],
  slots: ExpandedStarterSlot[],
  positionOf: (playerId: string) => string | null | undefined,
): string[] {
  const n = slots.length
  const ids = starters.slice(0, Math.max(n, starters.length)).map((id, i) => ({ id, i })).filter((x) => x.id)
  const eligible = (id: string, s: number) => playerEligibleForSlot(slots[s], positionOf(id))
  const seat: Array<number | null> = new Array(n).fill(null) // slot → index into ids
  const prefs = (k: number) => {
    const own = ids[k].i
    const order = own < n ? [own] : []
    for (let s = 0; s < n; s++) if (s !== own) order.push(s)
    return order
  }
  const tryPlace = (k: number, seen: boolean[]): boolean => {
    for (const s of prefs(k)) {
      if (seen[s] || !eligible(ids[k].id, s)) continue
      seen[s] = true
      const cur = seat[s]
      if (cur == null || tryPlace(cur, seen)) {
        seat[s] = k
        return true
      }
    }
    return false
  }
  const unplaced: number[] = []
  ids.forEach((_, k) => {
    if (!tryPlace(k, new Array(n).fill(false))) unplaced.push(k)
  })
  const out = seat.map((k) => (k == null ? '' : ids[k].id))
  for (const k of unplaced) {
    const open = out.indexOf('')
    if (open < 0) break
    out[open] = ids[k].id
  }
  return out
}
