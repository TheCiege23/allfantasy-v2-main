/**
 * The Best lineup card's seat-by-seat changes, regrouped into what a manager actually does.
 *
 * ⚠ ONE MOVE READ AS THREE (live, 2026-11-06). The solver reports a change per SEAT, so benching
 * one receiver for one tight end printed three rows — WR Wilson → Golden, TE LaPorta → Warren,
 * FLEX Golden → LaPorta — with Golden struck out in one row and starting in another. The real
 * decision was "start Warren, bench Wilson"; Golden and LaPorta only change seats.
 *
 * So: a player who comes IN and was not starting is a start, a starter who goes OUT and does not
 * come back is a bench, and a player who appears on both sides is a seat move. Names identify
 * players here because they are unique within one roster and the solver's rows carry nothing else.
 *
 * Client-safe: no imports beyond a type.
 */
import type { LineupOptimizerChange } from '@/lib/decision-os/lineup/bestLineup'

export type LineupChangeSummary = {
  starts: Array<{ name: string; projected: number; slotLabel: string; emptySeat: boolean }>
  benches: Array<{ name: string; projected: number | null }>
  moves: Array<{ name: string; fromSlot: string; toSlot: string }>
}

export function summarizeLineupChanges(changes: readonly LineupOptimizerChange[]): LineupChangeSummary {
  const outSlot = new Map<string, LineupOptimizerChange>()
  for (const c of changes) if (c.outName) outSlot.set(c.outName, c)
  const inNames = new Set(changes.map((c) => c.inName))

  const starts: LineupChangeSummary['starts'] = []
  const moves: LineupChangeSummary['moves'] = []
  for (const c of changes) {
    const from = outSlot.get(c.inName)
    if (from) moves.push({ name: c.inName, fromSlot: from.slotLabel, toSlot: c.slotLabel })
    else starts.push({ name: c.inName, projected: c.inProjected, slotLabel: c.slotLabel, emptySeat: c.outName == null })
  }
  const benches: LineupChangeSummary['benches'] = changes
    .filter((c): c is LineupOptimizerChange & { outName: string } => c.outName != null && !inNames.has(c.outName))
    .map((c) => ({ name: c.outName, projected: c.outProjected }))

  return { starts, benches, moves }
}
