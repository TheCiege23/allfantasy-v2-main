import { canFillSlot, shareAnySlot, slotForStarterIndex } from './slotEligibility'

/**
 * "Who does he replace?" — the inverse of the replacement question.
 *
 * `getPlayerImpact` has always answered "he is hurt, who on the bench plays
 * INSTEAD of him". This answers the other half, for a player who is NOT
 * starting: which current starter is the weakest one he is eligible to take
 * over from, priced under the same league's scoring. That is the "Swap
 * Ferguson out for Kincaid at FLEX · +2.4" card in the handoff, and it is the
 * only move on the screen that can carry a real, per-league point delta.
 *
 * ⚠ CLIENT-SAFE ON PURPOSE: no prisma, no 'server-only'. Everything it needs
 * is passed in, so the same function is testable without a database and the
 * impact loader stays the only place that knows how to read a roster.
 *
 * ⚠ AN UNPRICED STARTER IS NEVER THE ONE TO DISPLACE. A starter the feed does
 * not carry is unknown, not weak — treating him as zero would recommend
 * benching whoever the projection feed happened to miss that week. He is
 * skipped, and if every eligible starter is unpriced there is no answer.
 *
 * ⚠ THE SLOT DECIDES ELIGIBILITY, NOT THE STARTER'S POSITION. The same rule the
 * replacement engine uses, for the same reason: in a superflex league a TE can
 * take the SUPER_FLEX slot from a QB, and matching positions would never offer
 * it. When the lineup cannot be pinned (`slotForStarterIndex` returns null) the
 * weaker `shareAnySlot` test is used and the caller already surfaces that via
 * `slotConfirmed`.
 */

export type StartOver = {
  /** The starter he would replace. */
  playerId: string
  name: string
  position: string | null
  /** The displaced starter's club, for his lineup lock (swapLegality.ts); null when the roster row has none. */
  team: string | null
  /** The exact slot he would take, or null when the lineup could not be pinned. */
  slot: string | null
  /** The displaced starter's points under this league's scoring. */
  afPoints: number
  /**
   * Benched player's points minus the starter's, same scoring. Positive means
   * starting him gains points; zero or negative means the bench is correct.
   */
  delta: number
}

export function pickStartOver(args: {
  benched: { position: string | null; afPoints: number | null }
  /** Starter ids in lineup order — the roster's `starters` array. */
  starters: readonly string[]
  /** The league's starting slots in lineup order, or null when not stored. */
  slots: string[] | null
  playerById: (id: string) => { name: string; position: string | null; team?: string | null } | undefined
  /** Points under this league's scoring, or null when he cannot be priced. */
  priceOf: (id: string) => number | null
}): StartOver | null {
  const { benched, starters, slots, playerById, priceOf } = args
  // A benched player we cannot price cannot be compared to anyone.
  if (benched.afPoints == null) return null

  let weakest: StartOver | null = null

  for (let i = 0; i < starters.length; i++) {
    const id = starters[i]
    if (!id) continue
    const row = playerById(id)
    if (!row) continue

    const slot = slotForStarterIndex(slots, starters.length, i)
    const eligible = slot
      ? canFillSlot(slot, benched.position)
      : shareAnySlot(slots, benched.position, row.position)
    if (!eligible) continue

    const pts = priceOf(id)
    if (pts == null) continue

    if (!weakest || pts < weakest.afPoints) {
      weakest = {
        playerId: id,
        name: row.name,
        position: row.position,
        team: row.team ?? null,
        slot,
        afPoints: pts,
        delta: Math.round((benched.afPoints - pts) * 100) / 100,
      }
    }
  }

  return weakest
}
