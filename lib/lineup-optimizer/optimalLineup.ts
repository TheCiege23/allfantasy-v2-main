/**
 * The canonical EXACT optimal-lineup primitive.
 *
 * 🛑 WHY A NEW ONE RATHER THAN REUSING BEST BALL'S. `lib/bestball/optimizerCore.ts` is
 * `bestball-greedy-v1`: it fills every non-`FLEX`/`UTIL` slot first, in ARRAY ORDER, taking the
 * highest-scoring eligible player each time. That is not optimal, and the counterexample is not
 * exotic — a `SUPER_FLEX` slot is not named `FLEX`, so it lands in the first pass, and if it happens
 * to precede `QB` in the slot array the greedy pass burns the best quarterback in the flex:
 *
 *     slots   [SUPER_FLEX(QB/RB/WR/TE), QB]
 *     players QB_A 30, RB_B 25, QB_C 5
 *     greedy  SUPER_FLEX <- QB_A(30), QB <- QB_C(5)   = 35
 *     optimal QB <- QB_A(30), SUPER_FLEX <- RB_B(25)  = 55
 *
 * A twenty-point miss, silently, on a metric whose entire purpose is to be the number nobody can
 * manipulate. `__tests__/commissioner-os/efl/optimalLineup.test.ts` runs that exact case through
 * BOTH implementations and pins both answers, so this is a measurement rather than an assertion.
 *
 * ⚠ BEST BALL IS NOT CHANGED BY THIS FILE. Its optimizer, its snapshots and its behaviour are
 * untouched; Best Ball has its own product semantics (and its own tie/alternate reporting) and
 * repointing it is a separate, user-visible decision. This module exists so that it CAN adopt the
 * primitive later without either side being rewritten.
 *
 * ## The algorithm, and why it is provably optimal
 *
 * A player's value does not depend on WHICH slot he fills — a 20-point RB is worth 20 in RB and 20
 * in FLEX. That single property is what makes this easy: the sets of players that can be legally
 * seated simultaneously form a TRANSVERSAL MATROID, and for a matroid the greedy algorithm
 * (consider elements in descending weight, keep one whenever the set stays independent) yields a
 * maximum-weight basis.
 *
 * So: sort players by points descending, and for each try to seat him via an AUGMENTING PATH
 * (Kuhn's bipartite matching), which may re-seat players already placed. Never a straight greedy
 * pick per slot — that is precisely what makes the Best Ball version wrong.
 *
 * ⚠ AND BECAUSE EVERY PLAYER IS TRIED, THE RESULT IS A MAXIMUM-CARDINALITY MATCHING TOO. That
 * matters when points can be NEGATIVE (a three-interception quarterback, most IDP scoring): a
 * required slot still gets filled, because leaving it empty is not a legal lineup, and the negative
 * player is seated LAST — only once no positive player could take that seat.
 *
 * Pure: players and slots in, an assignment out. No DB, no clock, no randomness.
 */

/** One roster slot, expanded from a template row. `count` becomes that many seats. */
export type LineupSlotSpec = {
  /** `QB`, `RB`, `FLEX`, `SUPER_FLEX`, `IDP_FLEX`, … Display and provenance only. */
  slot: string
  /**
   * Positions that may fill it. `*` means any.
   *
   * ⚠ NORMALISE BEFORE CALLING. This module compares uppercase strings exactly and forms no opinion
   * about whether `DEF` and `DST` are the same thing — `lib/commissioner-os/efl/maxPfReads.ts` owns
   * that mapping, because getting it wrong in one place is recoverable and getting it wrong in two
   * is a drift bug.
   */
  eligible: readonly string[]
  count: number
  /** Ordering is part of provenance only; the result does not depend on it. Asserted in tests. */
  slotOrder?: number
}

export type OptimizerPlayerInput = {
  playerId: string
  /** Every position he qualifies at. A dual-eligible player still occupies exactly ONE seat. */
  positions: readonly string[]
  points: number
  playerName?: string | null
}

export type OptimalSlotAssignment = {
  slot: string
  /** Which seat of that slot, 1-based, so `FLEX #2` is distinguishable in an explanation. */
  seat: number
  playerId: string
  playerName: string | null
  points: number
}

export type OptimalLineupResult = {
  total: number
  assignments: OptimalSlotAssignment[]
  /** Seats no eligible player could fill. Reported, never silently dropped. */
  unfilledSlots: { slot: string; seat: number }[]
  /** Rostered players who did not make the optimal lineup. */
  unusedPlayerIds: string[]
  provenance: {
    algorithm: string
    seatCount: number
    playerCount: number
    /**
     * A different player set could score the same total.
     *
     * ⚠ THE TOTAL IS STILL EXACT — this flags that the CHOICE is not unique, which matters only for
     * explaining "why him and not her". Max PF is a number, so a tie never changes the answer.
     */
    tiedAlternativeExists: boolean
  }
}

export const OPTIMAL_LINEUP_ALGORITHM = 'exact-transversal-matroid-v1'

type Seat = { slot: string; seat: number; eligible: ReadonlySet<string>; any: boolean }

function expandSeats(slots: readonly LineupSlotSpec[]): Seat[] {
  const seats: Seat[] = []
  /*
   * ⚠ SORTED BY `slotOrder` THEN NAME SO SEAT ORDER IS A FUNCTION OF THE TEMPLATE, not of array
   * order. The RESULT does not depend on it — an exact algorithm cannot — but the reported
   * assignment order does, and an unstable one makes two runs impossible to diff.
   */
  const ordered = [...slots].sort(
    (a, b) => (a.slotOrder ?? 0) - (b.slotOrder ?? 0) || (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0),
  )
  for (const s of ordered) {
    const eligible = new Set(s.eligible.map((e) => e.trim().toUpperCase()))
    const any = eligible.has('*')
    for (let i = 0; i < Math.max(0, s.count); i += 1) {
      seats.push({ slot: s.slot, seat: i + 1, eligible, any })
    }
  }
  return seats
}

function eligibleFor(player: OptimizerPlayerInput, seat: Seat): boolean {
  if (seat.any) return true
  for (const p of player.positions) {
    if (seat.eligible.has(p.trim().toUpperCase())) return true
  }
  return false
}

export function computeOptimalLineup(input: {
  players: readonly OptimizerPlayerInput[]
  slots: readonly LineupSlotSpec[]
}): OptimalLineupResult {
  const seats = expandSeats(input.slots)

  /*
   * ⚠ TIES BREAK ON `playerId`, NOT ON INPUT ORDER. Two players on identical points is common at
   * zero, and an unstable tiebreak makes the same inputs produce different (equally optimal)
   * lineups across runs — which is fine for the total and fatal for a fingerprint.
   */
  const players = [...input.players].sort(
    (a, b) => b.points - a.points || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
  )

  /** Precomputed adjacency: for each player, the seat indices he may occupy. */
  const seatsFor: number[][] = players.map((p) => {
    const out: number[] = []
    for (let s = 0; s < seats.length; s += 1) if (eligibleFor(p, seats[s]!)) out.push(s)
    return out
  })

  /** seatIndex -> playerIndex, or -1. */
  const seatOwner = new Array<number>(seats.length).fill(-1)

  /**
   * Kuhn's augmenting path.
   *
   * 🛑 THE RE-SEATING IS THE WHOLE POINT. When a player's every eligible seat is taken, this asks
   * each current occupant to move somewhere else. That cascade is exactly what a per-slot greedy
   * pick cannot do, and it is what turns the SUPER_FLEX counterexample in the header from 35 into
   * 55.
   */
  function seat(playerIdx: number, visited: boolean[]): boolean {
    for (const s of seatsFor[playerIdx]!) {
      if (visited[s]) continue
      visited[s] = true
      if (seatOwner[s] === -1 || seat(seatOwner[s]!, visited)) {
        seatOwner[s] = playerIdx
        return true
      }
    }
    return false
  }

  for (let i = 0; i < players.length; i += 1) {
    seat(i, new Array<boolean>(seats.length).fill(false))
  }

  const assignments: OptimalSlotAssignment[] = []
  const unfilledSlots: { slot: string; seat: number }[] = []
  const used = new Set<string>()

  for (let s = 0; s < seats.length; s += 1) {
    const owner = seatOwner[s]!
    if (owner === -1) {
      unfilledSlots.push({ slot: seats[s]!.slot, seat: seats[s]!.seat })
      continue
    }
    const p = players[owner]!
    used.add(p.playerId)
    assignments.push({
      slot: seats[s]!.slot,
      seat: seats[s]!.seat,
      playerId: p.playerId,
      playerName: p.playerName ?? null,
      points: p.points,
    })
  }

  const total = assignments.reduce((sum, a) => sum + a.points, 0)

  /*
   * A tie exists when a benched player scored exactly as much as somebody who was seated AND could
   * have taken a seat. Cheap, and deliberately conservative — it may say "tied" where a swap is not
   * actually legal, which is the harmless direction for a field that only annotates an explanation.
   */
  const seatedPoints = new Set(assignments.map((a) => a.points))
  const tiedAlternativeExists = players.some(
    (p, i) => !used.has(p.playerId) && seatsFor[i]!.length > 0 && seatedPoints.has(p.points),
  )

  return {
    total: Math.round(total * 100) / 100,
    assignments,
    unfilledSlots,
    unusedPlayerIds: players.filter((p) => !used.has(p.playerId)).map((p) => p.playerId).sort(),
    provenance: {
      algorithm: OPTIMAL_LINEUP_ALGORITHM,
      seatCount: seats.length,
      playerCount: players.length,
      tiedAlternativeExists,
    },
  }
}
