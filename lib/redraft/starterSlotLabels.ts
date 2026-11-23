/**
 * Give every starter a slot label the league's lineup actually has.
 *
 * 🛑 A FLEX STARTER WAS STORED UNDER HIS POSITION (2026-11-23). The draft writes a starter's
 * `RedraftRosterPlayer.slotType` as his position (`finalizeDraftToRedraftSeason` "starters" → position) and
 * the lineup sync keeps any starter label it finds (it compares only the CATEGORY), so a team starting
 * three RBs in an RB/RB/FLX layout held RB, RB, RB. Scoring was right — it counts every non-bench slot —
 * but `validateRedraftLineup` reads labels literally and called it `starter_slot_overflow` with FLX
 * `missing_starter_slot`, so the lineup screen showed a legal lineup as illegal. Measured on both of the
 * owner's NFL teams and every AI seat in Zombie Chimmy Test.
 *
 * ONLY LABELS CHANGE. A starter stays a starter and a bench player stays on the bench; nothing here can
 * move a player in or out of the lineup, so no scoring changes and no game lock is involved. The seating is
 * the draft room's own maximum matching (`matchStarterSlots`, which also moves a multi-position player out
 * of a flex when another needs it), over the validator's own slot model (`starterCapacities` +
 * `allowedPositionsForSlot`), so what this writes is what the validator accepts.
 *
 * Pure.
 */
import { allowedPositionsForSlot, isNonStarterSlot, normalizeToken, redraftPlayerPositionTokens } from '@/lib/redraft/lineupValidation'
import { matchStarterSlots } from '@/lib/redraft/nativeDraftRosterTemplate'

export type LabelledStarter = { id: string; position: string | null; slotType: string }

/** True when the current labels are already a legal seating: every label fits its player and no slot overflows. */
function labelsAlreadyFit(sport: string, starters: readonly LabelledStarter[], capacities: ReadonlyMap<string, number>): boolean {
  const used = new Map<string, number>()
  for (const s of starters) {
    const label = normalizeToken(s.slotType)
    if (!capacities.has(label)) return false
    const positions = redraftPlayerPositionTokens(s.position)
    if (!positions.some((p) => allowedPositionsForSlot(sport, label).includes(p))) return false
    used.set(label, (used.get(label) ?? 0) + 1)
    if ((used.get(label) ?? 0) > (capacities.get(label) ?? 0)) return false
  }
  return true
}

/** The label changes that make these starters fit `capacities`, as row id → new label. Empty when they already fit. */
export function starterSlotLabelChanges(
  sport: string,
  rows: readonly LabelledStarter[],
  capacities: ReadonlyMap<string, number>,
): Map<string, string> {
  const starters = rows.filter((s) => !isNonStarterSlot(s.slotType))
  const out = new Map<string, string>()
  // A legal lineup is never reshuffled.
  if (starters.length === 0 || labelsAlreadyFit(sport, starters, capacities)) return out

  // Position slots first, then flex slots narrowest first, so the matcher seats a player in his own slot
  // before a FLEX, and a FLEX before a SUPERFLEX that a QB may need.
  const width = (slot: string) => allowedPositionsForSlot(sport, slot).length
  const slotNames = [...capacities.entries()]
    .flatMap(([slot, count]) => Array.from({ length: Math.max(0, count) }, () => slot))
    .sort((a, b) => width(a) - width(b))
  const seats = matchStarterSlots(
    starters.map((s) => s.position ?? ''),
    slotNames.map((slot) => ({ allowedPositions: allowedPositionsForSlot(sport, slot) })),
  )
  starters.forEach((s, i) => {
    const seat = seats[i]
    // Nobody can seat him (more starters than slots, or no slot takes his position): leave his label for the
    // validator to report rather than invent one.
    if (seat == null) return
    const label = slotNames[seat]!
    if (label !== normalizeToken(s.slotType)) out.set(s.id, label)
  })
  return out
}
