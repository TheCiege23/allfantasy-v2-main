/**
 * Who moves to the bench when a scheduled change takes a starting spot away (./rosterSchedule.ts
 * `starter_to_bench`), and the lineup that leaves.
 *
 * THE RULE (owner, 2026-11-25): the player sitting in the spot that is removed goes to the bench. A saved
 * starter remembers his seat (`slotIndex`, lib/league/lineupSlotPositions.ts), so "the Flex spot is gone" means
 * the player who was in the Flex seat, not whichever flex-eligible player a matching happens to leave out.
 *
 * THEN A SAFETY NET, because the rule above can only see seats that were saved: after it, anyone the CHANGE
 * left without a seat is benched too. That is decided by the lineup validator's own model (its slot capacities
 * and which positions each slot takes) and a maximum matching, so nobody is benched who could have been seated.
 * It covers a lineup saved before seats were stored, and it is the whole rule for a roster whose saved seats
 * may already be in the new layout's terms (`trustSavedSeats: false`).
 *
 * 🛑 "LEFT WITHOUT A SEAT BY THE CHANGE", NOT "WITHOUT A SEAT". A stored row with no position is read as the
 * placeholder `UTIL` (lib/roster/LineupTemplateValidation.ts), which no football slot takes, so "cannot be
 * seated in the new layout" alone benched every starter of such a lineup. A player the OLD layout could not
 * seat either was not unseated by this change, whatever is wrong with his row, and is left where he is. Last,
 * a plain count: more starters than seats is an overflow however the rows read, and the last ones go.
 *
 * WHY THIS MUST HAPPEN AT ALL. Weekly scoring counts whoever is stored as a starter and never checks the layout
 * (lib/redraft/scoringEngine.ts). A spot taken away with its player left in place is an extra scoring starter
 * for as long as that manager does nothing.
 *
 * Everyone else keeps his seat: a remaining starter's saved position is moved to wherever the same seat now is
 * (./rosterSeatRemap.ts), in the same lineup. Nobody is dropped; the bench spot the change adds is the room.
 *
 * Pure. The write is the lineup engine's, in ./rosterScheduleApply.ts.
 */
import { buildPlayerDataFromSections, getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { STARTER_SLOT_INDEX_KEY, starterSlotIndexOf } from '@/lib/league/lineupSlotPositions'
import { allowedPositionsForSlot } from '@/lib/redraft/lineupValidation'
import { matchStarterSlots } from '@/lib/redraft/nativeDraftRosterTemplate'
import { seatMoves } from './rosterSeatRemap'

export type BenchedPlayer = { id: string; name: string | null }
export type BenchPlan = { playerData: Record<string, unknown>; benched: BenchedPlayer[] }

type Row = Record<string, unknown>
const idOf = (row: Row) => String(row.id ?? '').trim()
const nameOf = (row: Row): string | null => {
  for (const key of ['name', 'full_name', 'fullName', 'playerName', 'player_name']) {
    const v = row[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}
const positionOf = (row: Row) => (typeof row.position === 'string' ? row.position.trim() : '')

/** The starters the new layout cannot seat, by the validator's slots and a maximum matching. */
export function unseatableStarters(sport: string, starters: ReadonlyArray<{ id: string; position: string }>, capacities: ReadonlyMap<string, number>): string[] {
  // Position slots first, then flex slots narrowest first, as lib/redraft/starterSlotLabels.ts seats them.
  const width = (slot: string) => allowedPositionsForSlot(sport, slot).length
  const slots = [...capacities.entries()]
    .flatMap(([slot, count]) => Array.from({ length: Math.max(0, count) }, () => slot))
    .sort((a, b) => width(a) - width(b))
  const seats = matchStarterSlots(
    starters.map((s) => s.position),
    slots.map((slot) => ({ allowedPositions: allowedPositionsForSlot(sport, slot) })),
  )
  return starters.filter((_, i) => seats[i] == null).map((s) => s.id)
}

/**
 * The lineup after the change, or null when nobody has to move.
 *
 * `capacities` is the NEW layout as the lineup validator reads it (lib/redraft/rosterConfigResolver.ts), and
 * `capacitiesBefore` the layout the change replaced.
 */
export function planBenchForRemovedSeats(input: {
  playerData: unknown
  sport: string
  seatsBefore: readonly string[]
  seatsAfter: readonly string[]
  capacities: ReadonlyMap<string, number>
  capacitiesBefore: ReadonlyMap<string, number>
  /** False when this roster changed after the layout did: its saved seats are then not the old layout's. */
  trustSavedSeats: boolean
}): BenchPlan | null {
  const sections = getNormalizedLineupSections(input.playerData)
  const starters = sections.starters as Row[]
  if (starters.length === 0) return null
  const moves = seatMoves(input.seatsBefore, input.seatsAfter)
  const leaving = new Set<string>()

  // 1. The player in a seat that no longer exists.
  if (input.trustSavedSeats) {
    for (const row of starters) {
      const at = starterSlotIndexOf(row)
      if (at != null && at < moves.length && moves[at] == null) leaving.add(idOf(row))
    }
  }

  // 2. Anyone the change left without a seat: unseatable now, and not already unseatable before it.
  const staying = () => starters.filter((r) => !leaving.has(idOf(r)))
  const all = starters.map((r) => ({ id: idOf(r), position: positionOf(r) }))
  const neverSeated = new Set(unseatableStarters(input.sport, all, input.capacitiesBefore))
  const candidates = staying().map((r) => ({ id: idOf(r), position: positionOf(r) }))
  for (const id of unseatableStarters(input.sport, candidates, input.capacities)) if (!neverSeated.has(id)) leaving.add(id)

  // 3. The count, which needs no positions: more starters than seats, and the last in the saved order go.
  const extra = staying().length - input.seatsAfter.length
  if (extra > 0) for (const row of staying().slice(-extra)) leaving.add(idOf(row))
  if (leaving.size === 0) return null

  const benchedRows = starters.filter((r) => leaving.has(idOf(r)))
  const kept = staying().map((row) => {
    const at = starterSlotIndexOf(row)
    if (at == null) return row
    const { [STARTER_SLOT_INDEX_KEY]: _old, ...rest } = row
    const to = input.trustSavedSeats && at < moves.length ? moves[at] : null
    return to == null ? rest : { ...rest, [STARTER_SLOT_INDEX_KEY]: to }
  })
  return {
    playerData: buildPlayerDataFromSections(input.playerData, { ...sections, starters: kept, bench: [...sections.bench, ...benchedRows] }),
    benched: benchedRows.map((r) => ({ id: idOf(r), name: nameOf(r) })),
  }
}

/** `playerData` with every starter's saved seat dropped, so the screen seats them itself. Same object if none. */
export function withoutStarterSeats(playerData: unknown): unknown {
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) return playerData
  const data = playerData as Record<string, unknown>
  const sections = data.lineup_sections
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) return playerData
  const starters = (sections as Record<string, unknown>).starters
  if (!Array.isArray(starters) || !starters.some((r) => starterSlotIndexOf(r) != null)) return playerData
  const next = starters.map((row) => {
    if (starterSlotIndexOf(row) == null) return row
    const { [STARTER_SLOT_INDEX_KEY]: _old, ...rest } = row as Row
    return rest
  })
  return { ...data, lineup_sections: { ...(sections as Record<string, unknown>), starters: next } }
}
