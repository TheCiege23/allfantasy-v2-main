/**
 * What a free agent adds to YOUR starting lineup, under the league's REAL lineup slots. PURE.
 *
 * ── 🛑 WHY THIS REPLACED A FIXED 1 QB / 2 RB / 2 WR / 1 TE ───────────────────────────────────
 * The FAAB pool (`faabPoolFor`) used to price every candidate against "your weakest starter at his
 * position", with the number of starters per position hard-coded. Asked live in a guillotine league
 * on 2026-09-28 whose lineup is FLEX ×4 + SUPER_FLEX, it told the user to bid $31 on Brian Thomas Jr.:
 * the user rostered ONE receiver, so the fixed table saw a second WR seat standing empty and priced
 * every free-agent receiver at his FULL value. "All eight upgrades are WRs" was that phantom seat,
 * not a weakness. In that lineup a receiver has to beat the weakest FLEX starter, whoever he is.
 *
 * So the gain is measured, not looked up: the value of your BEST legal lineup with him on the
 * roster, minus the value of your best legal lineup today, both from the exact optimizer
 * (`computeOptimalLineup`). That handles FLEX, SUPER_FLEX, REC_FLEX and the rest by construction,
 * and it names who actually drops out of the lineup.
 *
 * ⚠ SLOTS COME FROM `lineupSeatsFromSettings`, which returns null for a league with no stored slots
 * or with ANY slot it does not recognise. Null here means "use the fixed table and say so", never
 * "compute against fewer seats" — a lineup missing a seat is a smaller number that looks real.
 */

import { computeOptimalLineup, type LineupSlotSpec } from '@/lib/lineup-optimizer/optimalLineup'

export type LineupMember = {
  id: string
  name: string
  /** Normalised position (`normalizePosition`), the vocabulary the slot table accepts. */
  position: string
  /** Value under the league's scoring. Unknown counts as 0, as the fixed table always did. */
  value: number | null
}

export type LineupGain = {
  /** Best-lineup value with him, minus without. Never negative: you can always leave him benched. */
  gain: number
  /** Who leaves the starting lineup to make room, or null when he fills an otherwise empty seat. */
  displacedName: string | null
}

const toInput = (m: LineupMember) => ({
  playerId: m.id,
  positions: [m.position],
  points: typeof m.value === 'number' && Number.isFinite(m.value) ? m.value : 0,
  playerName: m.name,
})

/**
 * A calculator bound to one roster: the base lineup is solved once, each candidate costs one more
 * solve (a handful of players across a handful of seats, so a full waiver pool is cheap).
 */
export function lineupGainCalculator(
  seats: readonly LineupSlotSpec[],
  roster: readonly LineupMember[],
): (candidate: LineupMember) => LineupGain {
  const mine = roster.map(toInput)
  const base = computeOptimalLineup({ players: mine, slots: seats })
  const starting = new Map(base.assignments.map((a) => [a.playerId, a.playerName]))

  return (candidate) => {
    const withHim = computeOptimalLineup({ players: [...mine, toInput(candidate)], slots: seats })
    const gain = Math.max(0, withHim.total - base.total)
    if (gain <= 0) return { gain: 0, displacedName: null }
    const nowStarting = new Set(withHim.assignments.map((a) => a.playerId))
    let displacedName: string | null = null
    for (const [id, name] of starting) {
      if (!nowStarting.has(id)) {
        displacedName = name ?? null
        break
      }
    }
    return { gain, displacedName }
  }
}

/** "FLEX ×4, SUPER_FLEX" — the lineup a gain was measured against, for saying so to the user. */
export function describeSeats(seats: readonly LineupSlotSpec[]): string {
  const counts = new Map<string, number>()
  for (const s of seats) counts.set(s.slot, (counts.get(s.slot) ?? 0) + Math.max(0, s.count))
  return [...counts].map(([slot, n]) => (n > 1 ? `${slot} ×${n}` : slot)).join(', ')
}
