import { normalizePosition } from './positionNormalization'

/**
 * Which players can legally fill a given lineup slot, from the league's own
 * `roster_positions`.
 *
 * ⚠ THIS REPLACES A GUESS. The first version of the game-day replacement finder
 * widened every hole to RB/WR/TE and said so in a comment — which is wrong in
 * both directions: it offered a running back for a QB slot in a superflex league
 * (rejected by the platform) and it hid a quarterback who was legally eligible.
 * We hold `roster_positions` for 75 of 120 leagues, so for most leagues the real
 * answer is available and there is no reason to approximate it.
 *
 * ⚠ POSITIONAL INDEXING IS ONLY SAFE WHEN THE LENGTHS MATCH, AND OFTEN THEY DO
 * NOT. `Roster.playerData.starters` is positional against the non-bench slots —
 * starters[3] sits in the 4th starting slot — but measured on production, 27 of
 * 164 rosters store FEWER starters than the league has slots (one IDP league
 * stores 14 and 16 against 19 slots). When that happens every entry after the
 * gap is off by one, so a WR would be read as occupying the TE slot and the
 * replacement list would be confidently wrong. On a length mismatch this reports
 * the slot as unknown rather than shifting.
 */

/** Slots that are not part of the starting lineup. */
export const BENCH_SLOTS = new Set(['BN', 'IR', 'TAXI'])

/**
 * Slot -> the normalised positions it accepts.
 *
 * Keyed on Sleeper's vocabulary, which the importer preserves verbatim. An
 * unrecognised slot is handled by returning null rather than by falling through
 * to a permissive default — inventing eligibility for a slot we do not
 * understand is how the first version got it wrong.
 */
const SLOT_ACCEPTS: Record<string, string[]> = {
  QB: ['QB'],
  RB: ['RB', 'FB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF', 'DST'],
  FLEX: ['RB', 'FB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'FB', 'WR'],
  WRRB_WRT: ['RB', 'FB', 'WR', 'TE'],
  REC_FLEX: ['WR', 'TE'],
  // Superflex is the one that matters most for the QB case above.
  SUPER_FLEX: ['QB', 'RB', 'FB', 'WR', 'TE'],
  SUPERFLEX: ['QB', 'RB', 'FB', 'WR', 'TE'],
  QB_FLEX: ['QB', 'RB', 'FB', 'WR', 'TE'],
  DL: ['DL', 'DE', 'DT', 'NT'],
  LB: ['LB', 'ILB', 'OLB', 'MLB'],
  DB: ['DB', 'CB', 'S', 'FS', 'SS'],
  IDP_FLEX: ['DL', 'DE', 'DT', 'NT', 'LB', 'ILB', 'OLB', 'MLB', 'DB', 'CB', 'S', 'FS', 'SS'],
}

/** The starting slots, in lineup order, or null when the league has none stored. */
export function startingSlots(leagueSettings: unknown): string[] | null {
  const s = (leagueSettings ?? {}) as Record<string, unknown>
  const raw =
    (s.roster_positions as unknown) ??
    (s.rosterPositions as unknown) ??
    ((s.rosterSettings as Record<string, unknown> | undefined)?.roster_positions as unknown)
  if (!Array.isArray(raw) || raw.length === 0) return null
  const slots = raw.map((x) => String(x).toUpperCase()).filter((x) => !BENCH_SLOTS.has(x))
  return slots.length > 0 ? slots : null
}

/**
 * The slot a given starter occupies.
 *
 * Returns null when the roster stores a different number of starters than the
 * league has slots — see the header. Null means "we do not know which slot",
 * NOT "no slot".
 */
export function slotForStarterIndex(
  slots: string[] | null,
  startersLength: number,
  index: number
): string | null {
  if (!slots) return null
  if (slots.length !== startersLength) return null
  return slots[index] ?? null
}

/** Can a player at this position fill this slot? */
export function canFillSlot(slot: string, position: string | null): boolean {
  const accepts = SLOT_ACCEPTS[slot.toUpperCase()]
  if (!accepts) return false
  const p = normalizePosition(position)
  if (!p) return false
  return accepts.includes(p)
}

/**
 * Fallback when the exact slot is unknown: could ANY slot this league runs hold
 * BOTH of them?
 *
 * ⚠ THIS IS PRECISE, NOT A HEURISTIC, AND IT REPLACED ONE. The first fallback
 * grouped "skill positions" together, so an unconfirmed quarterback hole offered
 * running backs — noise in a normal league, and no better than the RB/WR/TE guess
 * it was meant to improve on. Asking whether some real slot accepts both players
 * gets the same answer for the right reason: in a superflex league a QB and an RB
 * share SUPER_FLEX and the swap is legal; in a league with no superflex they share
 * nothing and it is not.
 *
 * It is still weaker than knowing the exact slot — it says the swap is legal
 * SOMEWHERE in the lineup, not that it is legal in THIS hole — which is why the
 * caller reports `slotConfirmed: false` alongside it.
 */
export function shareAnySlot(
  slots: string[] | null,
  injuredPosition: string | null,
  candidatePosition: string | null
): boolean {
  const a = normalizePosition(injuredPosition)
  const b = normalizePosition(candidatePosition)
  if (!a || !b) return false
  if (!slots) {
    // No slot data at all for this league — same position is the only claim we
    // can defend, and it is never wrong.
    return a === b
  }
  return slots.some((s) => canFillSlot(s, injuredPosition) && canFillSlot(s, candidatePosition))
}
