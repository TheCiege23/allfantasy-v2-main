/**
 * Which lineup slot each starter is actually standing in.
 *
 * ── 🛑 THE ROSTER ANSWERED "WHO", AND THE QUESTION WAS "WHICH FLEX" ──────────────────────────
 *
 * After the canonical-registry fix, `contextFacts.roster` carries real names, positions and
 * teams. Measured on a live 8-team superflex dynasty (2026-09-01), all 27 players resolved.
 * Every one of them still carried `slot: null`, because `Roster.playerData` stores the provider's
 * player ids and nothing about the lineup shape.
 *
 * So for the question the proof surface was literally asked — "should I start my flex" — the
 * packet named eleven starters and could not say which two of them were the flexes.
 *
 * ── ⚠ WHY THIS IS A JOIN AND NOT A LOOKUP ───────────────────────────────────────────────────
 *
 * The slot vocabulary lives on the LEAGUE (`roster_positions`, in lineup order) and the players
 * live on the ROSTER. Neither knows the other. They are related only by ORDER: Sleeper writes
 * one template entry per starting slot and `Roster.playerData.starters` in the same sequence.
 *
 * That relationship is real but it is not enforced by anything, which is the whole reason this
 * module refuses rather than assumes. Both halves of the refusal are borrowed rather than
 * rewritten:
 *
 *   - `slotForStarterIndex` (lib/core-app/slotEligibility.ts) returns null on a LENGTH
 *     mismatch, because a template of 10 against a lineup of 11 means every index after the
 *     divergence is shifted, and a shifted label is confidently wrong rather than absent.
 *   - `startingSlotTemplate` (lib/core-app/rosterSlots.ts) already refuses ESPN's `"QB:1"`
 *     SLOT:COUNT shape outright — measured on production, expanding those pairs leads with QB
 *     while the same roster's `starters` leads with a WR, so there is nothing to align against.
 *
 * ── 🛑 AND THE CHECK THAT MAKES IT MORE THAN A GUESS: THE ZIP MUST CORROBORATE ITSELF ────────
 *
 * A length match is necessary and NOT sufficient — two arrays of eleven can both be eleven long
 * and describe different orderings. So every starter whose position we know is tested against
 * the slot the zip hands it, with the league's own eligibility table. If a single one does not
 * fit, the alignment is not trusted and NOTHING is stamped.
 *
 * That is deliberate and it is the difference between this and a plausible label: a kicker
 * appearing in the QB index is not a bad row to be skipped, it is proof the two arrays are not
 * in correspondence, and every other label drawn from the same zip is therefore unreliable too.
 * Per-row skipping would leave ten confident labels and one gap, which reads as "we know the
 * lineup, one player is odd" — the opposite of what was actually learned.
 *
 * ⚠ Players whose position did not resolve are NOT counted as failures. They cannot corroborate
 * and they cannot refute; a registry miss must not be able to suppress a correct alignment. They
 * are stamped on the strength of the starters that did corroborate.
 */

import { BENCH_SLOTS, canFillSlot, slotForStarterIndex } from '@/lib/core-app/slotEligibility'

/** The shape this needs from a starter — a subset of `RosterPlayerLite`. */
export type SlotStampable = {
  position: string | null
  slot: string | null
}

export type SlotStampResult =
  /** Every known-position starter fits the slot the zip gave it. `slots[i]` belongs to starter i. */
  | { stamped: true; slots: string[]; corroborated: number; unverifiable: number }
  /** Nothing was stamped. `reason` is written for a human reading a grounding gap. */
  | { stamped: false; reason: string }

/**
 * The league's starting slots in lineup order, from an already-loaded rules DTO.
 *
 * Takes the ARRAY rather than the settings object because the grounding packet has already paid
 * for `leagueRules` — `roster.starters` is that same `roster_positions` list with the bench
 * entries still on the end. Re-reading `League.settings` to get back to it would be a second
 * query for a value in hand.
 */
export function starterSlotsFromRules(rosterStarters: unknown): string[] | null {
  if (!Array.isArray(rosterStarters) || rosterStarters.length === 0) return null
  const cleaned = rosterStarters
    .map((v) => String(v ?? '').trim().toUpperCase())
    .filter((v) => v.length > 0)
  if (cleaned.length === 0) return null
  /*
   * ⚠ ESPN's SLOT:COUNT shape must not reach the zip — `"BE:7"` is not in BENCH_SLOTS, so it
   * would survive the filter and be handed out as a STARTING slot name. Same refusal, and the
   * same reason, as `startingSlotTemplate`.
   */
  if (cleaned.some((v) => /^[A-Z/]+:\d+$/.test(v))) return null
  const slots = cleaned.filter((v) => !BENCH_SLOTS.has(v))
  return slots.length > 0 ? slots : null
}

/**
 * Decide whether the template and the lineup are in correspondence, and if so, which slot each
 * starter holds. Pure — the caller applies the result.
 */
export function stampLineupSlots(args: {
  starters: readonly SlotStampable[]
  starterSlots: string[] | null
}): SlotStampResult {
  const { starters, starterSlots } = args
  if (starters.length === 0) return { stamped: false, reason: 'no starters to align' }
  if (!starterSlots) {
    return { stamped: false, reason: 'this league stores no starting-slot template' }
  }
  if (starterSlots.length !== starters.length) {
    return {
      stamped: false,
      reason: `the template lists ${starterSlots.length} starting slots but the lineup holds ${starters.length}, so the two are not in correspondence`,
    }
  }

  const slots: string[] = []
  let corroborated = 0
  let unverifiable = 0

  for (let i = 0; i < starters.length; i++) {
    const slot = slotForStarterIndex(starterSlots, starters.length, i)
    if (!slot) {
      return { stamped: false, reason: `no slot resolved for lineup position ${i + 1}` }
    }
    slots.push(slot)

    const position = starters[i]?.position ?? null
    if (!position) {
      unverifiable += 1
      continue
    }
    if (!canFillSlot(slot, position)) {
      return {
        stamped: false,
        reason: `lineup position ${i + 1} is a ${slot} slot but holds a ${position}, so the template and the lineup are not in the same order`,
      }
    }
    corroborated += 1
  }

  /*
   * ⚠ ZERO CORROBORATION IS NOT A PASS. If no starter's position resolved, the loop above
   * completes without a single eligibility check having run — a green result from a check that
   * never executed. That is the exact failure shape this repo keeps re-learning, so it is named
   * here rather than left to the reader.
   */
  if (corroborated === 0) {
    return {
      stamped: false,
      reason: 'no starter resolved to a position, so the lineup order could not be corroborated',
    }
  }

  return { stamped: true, slots, corroborated, unverifiable }
}
