/**
 * Keep every starter in the seat he is in when the league's layout gains a starting spot.
 *
 * A saved starter remembers his seat as `slotIndex`: a position in the league's ordered starter seats
 * (lib/league/lineupSlotPositions.ts, lib/league/lineupStarterSlots.ts). A new seat often lands in the MIDDLE
 * of that order. Measured on a real league, 2026-11-25: the seats of QB 1, RB 2, WR 2, TE 1, FLEX 1, K 1, DEF 1
 * read K QB RB1 RB2 TE WR1 WR2 DEF FLEX, and a third receiver becomes WR3 right after WR2. DEF and FLEX each
 * move down one, so a defense saved at position 7 would be drawn in the WR3 seat and the Flex player in the
 * defense's, with the Flex seat empty. (A Super Flex goes on the end and moves nobody.) Scoring would not care,
 * since a starter is scored by his position and never his seat, but every lineup in the league would look
 * wrong on the morning AllFantasy changed the roster for them.
 *
 * So after a scheduled change, each saved position is moved to wherever the SAME seat now is. A seat is known
 * by its slot and its number within that slot ("the second RB"): `RB2` before is `RB2` after, and `FLEX`
 * before is `FLEX1` after a second Flex is added. A position that names no seat that still exists is dropped,
 * which is the documented reading for a lineup with no positions: the screen seats that player itself.
 *
 * Pure.
 */
import { STARTER_SLOT_INDEX_KEY, starterSlotIndexOf } from '@/lib/league/lineupSlotPositions'

/** `RB2` → `RB#2`; `FLEX` → `FLEX#1`. No roster slot key ends in a digit (asserted in the tests). */
function seatIdentities(labels: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return labels.map((label) => {
    const slot = String(label).replace(/\d+$/, '')
    const n = (seen.get(slot) ?? 0) + 1
    seen.set(slot, n)
    return `${slot}#${n}`
  })
}

/** For each seat position before, its position after, or null when that seat is gone. */
export function seatMoves(before: readonly string[], after: readonly string[]): Array<number | null> {
  const where = new Map(seatIdentities(after).map((id, i) => [id, i]))
  return seatIdentities(before).map((id) => where.get(id) ?? null)
}

/**
 * `playerData` with each starter's saved seat moved to where that seat now is. Returns the SAME object when
 * nothing moves, so a caller can skip the write. Only `lineup_sections.starters[].slotIndex` is touched: who
 * starts, the order, and every other field are as they were.
 */
export function remapStarterSeats(playerData: unknown, before: readonly string[], after: readonly string[]): unknown {
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) return playerData
  const data = playerData as Record<string, unknown>
  const sections = data.lineup_sections
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) return playerData
  const starters = (sections as Record<string, unknown>).starters
  if (!Array.isArray(starters)) return playerData
  const moves = seatMoves(before, after)
  let changed = false
  const next = starters.map((row) => {
    const at = starterSlotIndexOf(row)
    if (at == null) return row
    const to = at < moves.length ? moves[at] : null
    if (to === at) return row
    changed = true
    const { [STARTER_SLOT_INDEX_KEY]: _old, ...rest } = row as Record<string, unknown>
    return to == null ? rest : { ...rest, [STARTER_SLOT_INDEX_KEY]: to }
  })
  if (!changed) return playerData
  return { ...data, lineup_sections: { ...(sections as Record<string, unknown>), starters: next } }
}
