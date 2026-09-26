/**
 * What a trade does to the LINEUP, as opposed to what it does to the ledger.
 *
 * ── 🛑 WHY THIS EXISTS: THE RECOMMENDATION ALREADY CLAIMS A DIMENSION IT CANNOT SEE ───────────
 *
 * `evaluateCanonicalTrade` calls itself "the production Decision OS entry point for every two-team
 * trade surface", and it is purely value-based: `recommendationFor` is a market-value ratio with
 * thresholds at 1.08 and 0.92 and nothing else. One of its own strings reads "Counter or accept
 * FOR ROSTER FIT" — advice about something it has no input for.
 *
 * A mature prospective engine does exist (`lib/engine/trade.ts` has `lineupImpact.starterDeltaPts`
 * and `championshipEquity`), and it reaches Player Finder, `af-legacy` and one AI route — never the
 * Trade Center or the trades panel. So the surface managers actually use answers "is this fair"
 * and never "does this make my team better on Sunday".
 *
 * ── PURE ON PURPOSE ───────────────────────────────────────────────────────────────────────────
 *
 * Positions and projections arrive already resolved (`enrichmentPort.resolveMetadata` and
 * `loadAfProjections`), so every branch below is testable without a database, a provider or a
 * league. The plumbing is a separate, reviewable step.
 */

export type ImpactPlayer = {
  playerId: string
  position: string
  /**
   * 🛑 NULL IS "NOT PRICED", NEVER ZERO. Zero is a real claim — "will score nothing" — and the
   * schema comment on `AFProjectionSnapshot.rosProjection` says so in as many words, because the
   * value engine acts on it. Every path here keeps the two apart.
   */
  projectedPoints: number | null
}

/** Slot name → positions that may fill it. Injected so a league's own slot vocabulary governs. */
export type SlotEligibility = Record<string, readonly string[]>

/**
 * Sleeper's slot vocabulary, which is the one imported leagues arrive in.
 *
 * ⚠ A SLOT THIS MAP DOES NOT KNOW IS NOT SILENTLY DROPPED — `fillLineup` reports it, and the
 * caller blocks. An unknown slot filled by nobody would understate the starting total by a whole
 * roster spot, and the number would still look like a number.
 */
export const DEFAULT_SLOT_ELIGIBILITY: SlotEligibility = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF', 'DST', 'D/ST'],
  DST: ['DST', 'DEF'],
  'D/ST': ['DEF', 'DST', 'D/ST'],
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  SUPERFLEX: ['QB', 'RB', 'WR', 'TE'],
  IDP_FLEX: ['DL', 'DE', 'DT', 'EDGE', 'LB', 'DB', 'CB', 'S', 'FS', 'SS'],
  DL: ['DL', 'DE', 'DT', 'EDGE'],
  DE: ['DE', 'EDGE'],
  DT: ['DT'],
  EDGE: ['EDGE', 'DE'],
  LB: ['LB'],
  DB: ['DB', 'CB', 'S', 'FS', 'SS'],
  CB: ['CB'],
  S: ['S', 'FS', 'SS'],
  FS: ['FS'],
  SS: ['SS'],
}

/** Slots that hold nobody and must never consume a player. */
const NON_STARTING_SLOTS = new Set(['BN', 'BE', 'BENCH', 'IR', 'TAXI'])

export type LineupFill = {
  points: number
  starterIds: string[]
  /** Slots left empty because no eligible player remained. */
  unfilledSlots: string[]
  /** Slot names absent from the eligibility map — a caller must treat these as blocking. */
  unknownSlots: string[]
  /**
   * Which player took which slot, in the lineup's DECLARED slot order (not the fill order), so a
   * reader can print "FLEX: Jayden Reed" rather than an unordered id list.
   */
  assignments: Array<{ slot: string; playerId: string }>
}

/**
 * The best starting lineup available from `players`.
 *
 * ── WHY GREEDY IS CORRECT HERE, RATHER THAN MERELY CONVENIENT ────────────────────────────────
 *
 * Slots are filled in order of how restrictive they are: a slot accepting one position is filled
 * before a FLEX accepting several. Within that order each slot takes the best remaining eligible
 * player. That is optimal for this slot structure because the eligibility sets are NESTED — a
 * dedicated RB slot's candidates are a subset of FLEX's — so a player displaced from a dedicated
 * slot can only ever land in a slot the replacement could also have filled, and the replacement is
 * by construction no better. It would NOT be optimal for arbitrary overlapping eligibility, which
 * is why the ordering is explicit rather than incidental.
 *
 * ⚠ UNPRICED PLAYERS ARE NOT CANDIDATES. They cannot be compared, and guessing a zero would push a
 * real starter out of the lineup in favour of someone recorded as scoring nothing.
 */
export function fillLineup(
  players: readonly ImpactPlayer[],
  slots: readonly string[],
  eligibility: SlotEligibility = DEFAULT_SLOT_ELIGIBILITY,
): LineupFill {
  const available = players
    .filter((p) => p.projectedPoints != null)
    .slice()
    .sort((a, b) => (b.projectedPoints as number) - (a.projectedPoints as number))

  const taken = new Set<string>()
  const unknownSlots: string[] = []
  const unfilledSlots: string[] = []
  const starterIds: string[] = []
  const byIndex: Array<{ index: number; slot: string; playerId: string }> = []
  let points = 0

  const starting = slots.filter((s) => !NON_STARTING_SLOTS.has(s.toUpperCase()))
  const ordered = starting
    .map((slot, index) => {
      const key = slot.toUpperCase()
      const elig = eligibility[key]
      return { slot: key, index, size: elig ? elig.length : Number.POSITIVE_INFINITY, elig }
    })
    // Most restrictive first; original order breaks ties so the result is deterministic.
    .sort((a, b) => a.size - b.size || a.index - b.index)

  for (const { slot, index, elig } of ordered) {
    if (!elig) {
      unknownSlots.push(slot)
      continue
    }
    const pick = available.find((p) => !taken.has(p.playerId) && elig.includes(p.position.toUpperCase()))
    if (!pick) {
      unfilledSlots.push(slot)
      continue
    }
    taken.add(pick.playerId)
    starterIds.push(pick.playerId)
    byIndex.push({ index, slot, playerId: pick.playerId })
    points += pick.projectedPoints as number
  }

  const assignments = byIndex.sort((a, b) => a.index - b.index).map(({ slot, playerId }) => ({ slot, playerId }))
  return { points, starterIds, unfilledSlots, unknownSlots, assignments }
}

/**
 * Depth at one position, counted two ways because one way is not enough.
 *
 * 🛑 BENCH COUNT ALONE IS THE WRONG PROXY, AND A TEST CAUGHT IT. Trade an RB away and a FLEX RB
 * simply slides into the vacated RB slot: the bench count is UNCHANGED while the roster genuinely
 * holds one fewer RB. Reporting only the bench would have said "no depth lost" about a trade that
 * cost a body — plausible, specific, and wrong.
 *
 * `rostered*` answers "how many do I have", `bench*` answers "how many are spare after the lineup
 * is set". A trade can move either without the other, so both ship.
 */
export type DepthRow = {
  position: string
  rosteredBefore: number
  rosteredAfter: number
  rosteredDelta: number
  benchBefore: number
  benchAfter: number
  /** Bench delta. Kept as `delta` for callers that only care about spare bodies. */
  delta: number
}

export type ReplacementRow = {
  position: string
  /** Best non-starting player at this position — what an injury actually falls back to. */
  before: number | null
  after: number | null
}

export type RosterImpact = {
  startingPointsBefore: number | null
  startingPointsAfter: number | null
  startingPointsDelta: number | null
  /** Non-null when the delta could not be computed honestly. The caller renders it verbatim. */
  blockedReason: string | null
  /** Rostered players excluded from lineup candidacy because they carry no projection. */
  unpricedExcluded: number
  depth: DepthRow[]
  replacement: ReplacementRow[]
}

const EMPTY = (blockedReason: string, unpricedExcluded = 0): RosterImpact => ({
  startingPointsBefore: null,
  startingPointsAfter: null,
  startingPointsDelta: null,
  blockedReason,
  unpricedExcluded,
  depth: [],
  replacement: [],
})

function benchByPosition(players: readonly ImpactPlayer[], starterIds: readonly string[]): Map<string, ImpactPlayer[]> {
  const starters = new Set(starterIds)
  const out = new Map<string, ImpactPlayer[]>()
  for (const p of players) {
    if (starters.has(p.playerId)) continue
    const key = p.position.toUpperCase()
    const list = out.get(key) ?? []
    list.push(p)
    out.set(key, list)
  }
  for (const list of out.values()) {
    list.sort((a, b) => (b.projectedPoints ?? -Infinity) - (a.projectedPoints ?? -Infinity))
  }
  return out
}

/**
 * The lineup and depth consequences of one trade, for one roster.
 *
 * 🛑 AN UNPRICED *TRADED* ASSET BLOCKS THE WHOLE ANSWER, while an unpriced BENCH player only
 * reduces the candidate pool and is disclosed. The two are not the same failure: if the thing
 * being traded cannot be priced, the trade's effect is unknowable and any delta would be fiction.
 * A deep bench player nobody projects changes the answer only if he would have started, which the
 * disclosure lets a reader judge.
 */
export function computeRosterImpact(args: {
  roster: readonly ImpactPlayer[]
  slots: readonly string[]
  incoming: readonly ImpactPlayer[]
  outgoingPlayerIds: readonly string[]
  eligibility?: SlotEligibility
}): RosterImpact {
  const eligibility = args.eligibility ?? DEFAULT_SLOT_ELIGIBILITY

  const unpricedTraded = [...args.incoming].filter((p) => p.projectedPoints == null)
  const outgoing = new Set(args.outgoingPlayerIds)
  const outgoingUnpriced = args.roster.filter((p) => outgoing.has(p.playerId) && p.projectedPoints == null)
  if (unpricedTraded.length > 0 || outgoingUnpriced.length > 0) {
    const n = unpricedTraded.length + outgoingUnpriced.length
    return EMPTY(`${n} traded player(s) have no projection under this league's scoring, so the lineup effect cannot be computed`)
  }

  /*
   * ⚠ A PLAYER NAMED AS OUTGOING WHO IS NOT ON THE ROSTER MEANS THE ROSTER AND THE OFFER DISAGREE.
   * Continuing would compute an "after" lineup that still contains him, understating the loss —
   * a wrong number that looks exactly like a right one.
   */
  const rosterIds = new Set(args.roster.map((p) => p.playerId))
  const missing = args.outgoingPlayerIds.filter((id) => !rosterIds.has(id))
  if (missing.length > 0) {
    return EMPTY(`${missing.length} outgoing player(s) are not on this roster, so the two sides disagree about what is being traded`)
  }

  const before = args.roster
  const after = [...args.roster.filter((p) => !outgoing.has(p.playerId)), ...args.incoming]

  const fillBefore = fillLineup(before, args.slots, eligibility)
  const fillAfter = fillLineup(after, args.slots, eligibility)

  const unknown = [...new Set([...fillBefore.unknownSlots, ...fillAfter.unknownSlots])]
  if (unknown.length > 0) {
    return EMPTY(`the lineup contains slot(s) this model does not know how to fill: ${unknown.join(', ')}`)
  }

  const unpricedExcluded = [...before, ...args.incoming].filter((p) => p.projectedPoints == null).length

  const benchBefore = benchByPosition(before, fillBefore.starterIds)
  const benchAfter = benchByPosition(after, fillAfter.starterIds)
  /*
   * ⚠ EVERY POSITION ON THE ROSTER, NOT ONLY THOSE WITH A BENCH. Deriving this from the bench maps
   * alone means a position whose depth is ZERO is absent from the answer entirely — so a caller
   * asking "what is my RB depth" gets `undefined` and cannot tell it apart from "no RBs at all".
   * The interesting case for depth is precisely the position that has none.
   */
  const positions = [...new Set([...before, ...after].map((p) => p.position.toUpperCase()))].sort()

  const countAt = (players: readonly ImpactPlayer[], position: string) =>
    players.filter((p) => p.position.toUpperCase() === position).length

  const depth: DepthRow[] = positions.map((position) => {
    const b = benchBefore.get(position)?.length ?? 0
    const a = benchAfter.get(position)?.length ?? 0
    const rb = countAt(before, position)
    const ra = countAt(after, position)
    return {
      position,
      rosteredBefore: rb,
      rosteredAfter: ra,
      rosteredDelta: ra - rb,
      benchBefore: b,
      benchAfter: a,
      delta: a - b,
    }
  })

  const replacement: ReplacementRow[] = positions.map((position) => ({
    position,
    before: benchBefore.get(position)?.[0]?.projectedPoints ?? null,
    after: benchAfter.get(position)?.[0]?.projectedPoints ?? null,
  }))

  return {
    startingPointsBefore: fillBefore.points,
    startingPointsAfter: fillAfter.points,
    startingPointsDelta: fillAfter.points - fillBefore.points,
    blockedReason: null,
    unpricedExcluded,
    depth,
    replacement,
  }
}
