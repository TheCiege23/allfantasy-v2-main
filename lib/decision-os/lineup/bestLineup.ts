import { computeOptimalLineup, type LineupSlotSpec } from '@/lib/lineup-optimizer/optimalLineup'
import { BENCH_SWAP_POINTS, isEligibleForSlot } from '@/lib/core-app/rosterSlots'
import type { LineupPlayer, LineupSlot } from '@/lib/core-app/myTeam'

/**
 * The whole-lineup answer to "what is my best lineup this week?" — recommendation only.
 *
 * ⚠ WHY THIS EXISTS BESIDE THE BENCH CHECK. The bench check compares one bench player against one
 * starter at a time. Adding those gains up overstates the week: the same bench player can be the
 * best answer at two slots, and a FLEX shuffle can open a better swap than any single pair shows.
 * This runs the exact optimizer (`computeOptimalLineup`, the one Max PF uses) over every open seat at
 * once, so each player is counted once and the total is the real best total.
 *
 * Same guards as the bench check, on purpose:
 *   · `afProjectedPoints` only — the league's own scoring, never the generic PPR line;
 *   · a player on bye or ruled OUT is a guaranteed 0, which is the one honest zero;
 *   · an UNPRICED open starter ends it (null is not zero, and the total would be a guess);
 *   · a player whose game has kicked off is LOCKED: his seat and he are left out of the question;
 *   · eligibility comes from the league's slot template (`isEligibleForSlot`).
 *
 * Pure: slots, bench and a clock in, an answer out. AllFantasy never sets the lineup.
 */

export type LineupOptimizerChange = {
  slotIndex: number
  slotLabel: string
  /** Who sits there now; null for an empty seat. */
  outName: string | null
  outProjected: number | null
  inName: string
  inProjected: number
}

export type LineupOptimization =
  | { state: 'optimal'; currentTotal: number; lockedSeats: number }
  | {
      state: 'improve'
      currentTotal: number
      bestTotal: number
      gain: number
      /** `swap` when the gain clears BENCH_SWAP_POINTS; `close` when it sits inside projection noise. */
      verdict: 'swap' | 'close'
      changes: LineupOptimizerChange[]
      lockedSeats: number
    }

/** A gain below this is rounding, not a lineup change. */
const NO_CHANGE_EPSILON = 0.05

function valueOf(p: LineupPlayer): number | null {
  if (p.onBye || p.ruledOut) return 0
  return p.afProjectedPoints
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function optimizeLineup(args: {
  starters: readonly LineupSlot[]
  bench: readonly LineupPlayer[]
  sport?: string | null
  bestBall?: boolean
  now?: Date
}): LineupOptimization | null {
  const { starters, bench, sport } = args
  if (args.bestBall || starters.length === 0) return null
  const at = (args.now ?? new Date()).getTime()
  const locked = (p: LineupPlayer) => p.kickoff instanceof Date && p.kickoff.getTime() <= at

  const open: number[] = []
  let lockedSeats = 0
  for (let i = 0; i < starters.length; i += 1) {
    const slot = starters[i]
    // A filled seat we could not resolve is our identity gap, not a hole — no honest total exists.
    if (!slot.empty && !slot.player) return null
    if (slot.player && locked(slot.player)) {
      lockedSeats += 1
      continue
    }
    if (slot.player && valueOf(slot.player) == null) return null
    open.push(i)
  }
  if (open.length === 0) return null

  type Candidate = { id: string; player: LineupPlayer; value: number; position: string }
  const pool = new Map<string, Candidate>()
  const add = (p: LineupPlayer) => {
    const value = valueOf(p)
    const position = (p.position ?? '').trim().toUpperCase()
    if (value == null || !position || locked(p) || pool.has(p.sleeperId)) return
    pool.set(p.sleeperId, { id: p.sleeperId, player: p, value, position })
  }
  for (const i of open) if (starters[i].player) add(starters[i].player!)
  for (const p of bench) add(p)

  const positions = [...new Set([...pool.values()].map((c) => c.position))]
  const slots: LineupSlotSpec[] = open.map((i, order) => ({
    slot: String(i),
    eligible: positions.filter((pos) => isEligibleForSlot(starters[i].slotLabel, pos, sport)),
    count: 1,
    slotOrder: order,
  }))
  const result = computeOptimalLineup({
    slots,
    players: [...pool.values()].map((c) => ({ playerId: c.id, positions: [c.position], points: c.value })),
  })

  const currentTotal = round1(open.reduce((sum, i) => sum + (starters[i].player ? valueOf(starters[i].player!) ?? 0 : 0), 0))
  const bestTotal = round1(result.total)
  const gain = round1(bestTotal - currentTotal)
  if (gain < NO_CHANGE_EPSILON) return { state: 'optimal', currentTotal, lockedSeats }

  // Seat players so that everyone who stays keeps his own seat where that is possible.
  const target = arrange(open, starters, new Set(result.assignments.map((a) => a.playerId)), pool, sport)
    ?? new Map(result.assignments.map((a) => [Number(a.slot), a.playerId]))

  const changes: LineupOptimizerChange[] = []
  for (const i of open) {
    const inId = target.get(i)
    const current = starters[i].player
    if (!inId || inId === current?.sleeperId) continue
    const incoming = pool.get(inId)!
    changes.push({
      slotIndex: i,
      slotLabel: starters[i].slotLabel,
      outName: current?.name ?? null,
      outProjected: current ? valueOf(current) : null,
      inName: incoming.player.name,
      inProjected: incoming.value,
    })
  }
  if (changes.length === 0) return { state: 'optimal', currentTotal, lockedSeats }
  return {
    state: 'improve',
    currentTotal,
    bestTotal,
    gain,
    verdict: gain >= BENCH_SWAP_POINTS ? 'swap' : 'close',
    changes,
    lockedSeats,
  }
}

/**
 * Place the optimal set into the open seats, keeping each staying starter in his own seat, then
 * matching the rest (Kuhn's augmenting paths). Null when that cannot seat everyone, and the caller
 * falls back to the solver's own seating, which is always legal.
 */
function arrange(
  open: readonly number[],
  starters: readonly LineupSlot[],
  chosen: ReadonlySet<string>,
  pool: ReadonlyMap<string, { position: string }>,
  sport: string | null | undefined,
): Map<number, string> | null {
  const target = new Map<number, string>()
  const seated = new Set<string>()
  for (const i of open) {
    const id = starters[i].player?.sleeperId
    if (id && chosen.has(id)) {
      target.set(i, id)
      seated.add(id)
    }
  }
  const freeSeats = open.filter((i) => !target.has(i))
  const movers = [...chosen].filter((id) => !seated.has(id))
  const owner = new Map<number, string>()
  const fits = (id: string, seat: number) => isEligibleForSlot(starters[seat].slotLabel, pool.get(id)?.position, sport)
  const tryPlace = (id: string, seen: Set<number>): boolean => {
    for (const seat of freeSeats) {
      if (seen.has(seat) || !fits(id, seat)) continue
      seen.add(seat)
      const holder = owner.get(seat)
      if (!holder || tryPlace(holder, seen)) {
        owner.set(seat, id)
        return true
      }
    }
    return false
  }
  for (const id of movers) if (!tryPlace(id, new Set())) return null
  for (const [seat, id] of owner) target.set(seat, id)
  return target
}
