import { normalizePosition } from './positionNormalization'
import { canFillSlot, slotForStarterIndex } from './slotEligibility'

/**
 * Who can actually take an unavailable starter's place, in one league — from YOUR OWN roster.
 *
 * ⚠ IT REPLACED "SAME POSITION ON THE BENCH", WHICH WAS WRONG IN BOTH DIRECTIONS. Reported on
 * 2026-10-17 from a guillotine league: Jeremiyah Love (RB) Out, and the home said "swap in J.K.
 * Dobbins or Tyler Allgeier" on a Friday morning — Dobbins had played Thursday night, so his slot
 * was locked and the advice was impossible. And it never saw the flex: with Tony Pollard (RB)
 * starting at a W/R/T flex, "move Pollard into the RB slot and start a WR/TE at flex" is a real
 * option the same-position filter cannot express.
 *
 * So two kinds of answer, both legal moves on the platform:
 *   direct — a bench player who can fill the injured player's own slot;
 *   chain  — a starter who can slide INTO that slot (his game not started yet), with a bench
 *            player filling the slot he vacates. Offered only when it brings in someone the
 *            direct answer cannot — otherwise it is the same move with an extra step.
 *
 * Pure and client-safe; the caller decides what "can play" means (healthy, and his club still has
 * a game left this week) because only the caller holds the fixtures and the injury feed.
 */

export type CoverCandidate = {
  id: string
  name: string
  position: string | null
  /** Market rank, lower is better; null sorts last and never reads as "worthless". */
  rank: number | null
  /**
   * This week's projection under THE LEAGUE'S scoring, when one is on file. It outranks market
   * rank: "who do I start Sunday" is a this-week question, and a dynasty price answers a different
   * one. Null (or absent) falls back to rank, never to zero.
   */
  points?: number | null
  /**
   * Bench: healthy and his club still plays this week. Starter: not ruled out and his game has
   * not kicked off — a locked starter cannot be moved, so he is never a pivot.
   */
  canPlay: boolean
}

export type CoverChain = {
  /** The starter who slides into the injured player's slot. */
  move: string
  /** The injured player's slot — where `move` goes. */
  toSlot: string
  /** The slot `move` vacates. */
  fromSlot: string
  /** The bench player who fills `fromSlot`; null when only a free agent could. */
  fill: string | null
  /** `fill`'s projection this week, when known. */
  fillPoints?: number | null
  /**
   * Points this chain adds over the best direct swap — the reason it is shown at all. Null when
   * there is no direct swap to compare with, or either side has no projection.
   */
  gain?: number | null
}

export type CoverOptions = {
  direct: Array<{ name: string; position: string | null; points?: number | null }>
  chain: CoverChain | null
}

const DIRECT_LIMIT = 2

const round1 = (n: number) => Math.round(n * 10) / 10

function byRankThenName(a: CoverCandidate, b: CoverCandidate): number {
  const ap = a.points ?? null
  const bp = b.points ?? null
  if (ap !== bp) {
    if (ap == null) return 1
    if (bp == null) return -1
    return bp - ap
  }
  if (a.rank !== b.rank) {
    if (a.rank == null) return 1
    if (b.rank == null) return -1
    return a.rank - b.rank
  }
  return a.name.localeCompare(b.name)
}

export function coverOptions(input: {
  /** The league's starting slots in lineup order (`verification.slots`), or null. */
  slots: string[] | null
  /** `playerData.starters`, positional against `slots`. */
  orderedStarters: string[]
  injuredId: string
  injuredPosition: string | null
  /** Non-starters, IR and taxi already excluded. */
  bench: CoverCandidate[]
  /** Every other starter, keyed by id. */
  starters: Map<string, CoverCandidate>
}): CoverOptions {
  const { slots, orderedStarters, injuredId, injuredPosition } = input
  const playable = input.bench.filter((b) => b.canPlay && b.id !== injuredId)

  const injuredIndex = orderedStarters.indexOf(injuredId)
  const injuredSlot =
    injuredIndex >= 0 ? slotForStarterIndex(slots, orderedStarters.length, injuredIndex) : null

  // Slot unknown (no template, or a starters/slots length mismatch): same position is the only
  // claim we can defend, and no chain — a chain needs to know which slot each starter holds.
  if (!injuredSlot) {
    const want = normalizePosition(injuredPosition)
    if (!want) return { direct: [], chain: null }
    const direct = playable
      .filter((b) => normalizePosition(b.position) === want)
      .sort(byRankThenName)
      .slice(0, DIRECT_LIMIT)
    return { direct: direct.map((d) => ({ name: d.name, position: d.position, points: d.points ?? null })), chain: null }
  }

  const directPool = playable.filter((b) => canFillSlot(injuredSlot, b.position)).sort(byRankThenName)
  const directIds = new Set(directPool.map((d) => d.id))
  const direct = directPool.slice(0, DIRECT_LIMIT).map((d) => ({ name: d.name, position: d.position, points: d.points ?? null }))

  let best: { pivot: CoverCandidate; fromSlot: string; fill: CoverCandidate } | null = null
  let fallback: { pivot: CoverCandidate; fromSlot: string } | null = null
  orderedStarters.forEach((pid, index) => {
    if (index === injuredIndex) return
    const fromSlot = slots![index]
    if (!fromSlot || fromSlot === injuredSlot) return
    const pivot = input.starters.get(pid)
    if (!pivot || !pivot.canPlay) return
    if (!canFillSlot(injuredSlot, pivot.position)) return
    // Only someone the direct answer could not already offer makes the chain worth the extra step.
    const fill = playable
      .filter((b) => !directIds.has(b.id) && canFillSlot(fromSlot, b.position))
      .sort(byRankThenName)[0]
    if (fill) {
      if (!best || byRankThenName(fill, best.fill) < 0) best = { pivot, fromSlot, fill }
    } else if (!fallback) {
      fallback = { pivot, fromSlot }
    }
  })

  if (best) {
    const b = best as { pivot: CoverCandidate; fromSlot: string; fill: CoverCandidate }
    const fillPoints = b.fill.points ?? null
    const directBest = directPool[0]?.points ?? null
    const gain = fillPoints != null && directBest != null ? round1(fillPoints - directBest) : null
    // With both projections known, a chain that does not beat the simple swap is just more taps.
    if (gain != null && gain <= 0) return { direct, chain: null }
    return {
      direct,
      chain: { move: b.pivot.name, toSlot: injuredSlot, fromSlot: b.fromSlot, fill: b.fill.name, fillPoints, gain },
    }
  }
  // Nothing on the bench fits either way: the wider flex seat is still the better hole to take to
  // the waiver wire, so say which move opens it.
  if (direct.length === 0 && fallback) {
    const f = fallback as { pivot: CoverCandidate; fromSlot: string }
    return { direct, chain: { move: f.pivot.name, toSlot: injuredSlot, fromSlot: f.fromSlot, fill: null } }
  }
  return { direct, chain: null }
}

/** A lineup slot as a reader says it. */
export function coverSlotLabel(slot: string): string {
  const s = slot.toUpperCase()
  if (s === 'SUPER_FLEX' || s === 'SUPERFLEX' || s === 'QB_FLEX') return 'SUPERFLEX'
  if (s === 'WRRB_FLEX') return 'W/R FLEX'
  if (s === 'REC_FLEX') return 'W/T FLEX'
  if (s === 'WRRB_WRT') return 'FLEX'
  return s
}
