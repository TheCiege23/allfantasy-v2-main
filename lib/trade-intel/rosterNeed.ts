/**
 * What a roster is actually short of — layer 5 of the value ledger.
 *
 * ⚠ THIS IS THE LAYER THAT MAKES VALUE A TRIPLE. Layers 0–4 answer "what is this
 * player worth in this league". This one answers "what is he worth TO THIS
 * TEAM", and the two are different numbers. A second-round pick is one price on
 * the market and another to the manager whose only startable quarterback is a
 * backup.
 *
 * ⚠ AND IT CHANGES THE PRICE, NEVER THE VALUE. Nothing here belongs in a
 * ranking, a roster grade, or a player page — those are league-wide facts. This
 * applies to ONE deal between TWO specific teams and is discarded afterwards.
 *
 * ── Why another one ────────────────────────────────────────────────────────
 *
 * There are already five roster-need implementations in this repo
 * (`waiverRecommendationService`, `keeperRosterNeedsEngine`,
 * `nflDataFoundationService`, `DraftAdvisorContextService`, `trade-pre-analysis`)
 * and at least one of them is wrong in a way that matters:
 * `DraftAdvisorContextService.computeRosterNeeds` scores against a hardcoded
 * `STANDARD_STARTS` map, so in a superflex league it reports a team with one
 * quarterback as having no quarterback need — the single most valuable piece of
 * information in that format, inverted.
 *
 * This one reads the league's OWN starting slots. It is not a sixth opinion; it
 * is the one the ledger uses, and the others should migrate to it.
 */

/** Slot names that accept more than one position, and what they accept. */
const FLEX_ELIGIBILITY: Record<string, string[]> = {
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  WRRB_WRT: ['RB', 'WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  SUPERFLEX: ['QB', 'RB', 'WR', 'TE'],
  SF: ['QB', 'RB', 'WR', 'TE'],
  IDP_FLEX: ['DL', 'LB', 'DB'],
  /* Sleeper's catch-all defensive slot. */
  DEF_FLEX: ['DL', 'LB', 'DB'],
}

/** Slots that are not a position at all and cannot generate a need. */
const NON_PLAYING_SLOTS = new Set(['BN', 'IR', 'TAXI', 'RES', 'BENCH'])

export type SlotRequirements = {
  /** Positions with a slot of their own, and how many. */
  dedicated: Map<string, number>
  /** Multi-position slots, each with the positions it accepts. */
  flex: Array<{ slot: string; eligible: string[] }>
}

/**
 * Read a league's starting lineup into requirements.
 *
 * Returns null for an empty or unreadable lineup rather than falling back to a
 * default shape — a guessed lineup produces confident needs for a league we
 * cannot see, which is exactly the bug this module exists to replace.
 */
export function readSlotRequirements(starters: unknown): SlotRequirements | null {
  if (!Array.isArray(starters) || starters.length === 0) return null

  const dedicated = new Map<string, number>()
  const flex: Array<{ slot: string; eligible: string[] }> = []

  for (const raw of starters) {
    const slot = String(raw).toUpperCase().trim()
    if (!slot || NON_PLAYING_SLOTS.has(slot)) continue
    const eligible = FLEX_ELIGIBILITY[slot]
    if (eligible) flex.push({ slot, eligible })
    else dedicated.set(slot, (dedicated.get(slot) ?? 0) + 1)
  }

  if (dedicated.size === 0 && flex.length === 0) return null
  return { dedicated, flex }
}

export type PositionNeed = {
  position: string
  /** Dedicated slots this league starts at the position. */
  required: number
  /** Players on the roster who can fill them. */
  have: number
  /**
   * Slots this roster cannot fill. THE NUMBER THAT MATTERS: a deficit means
   * points are being left on the table every week, not merely that depth is
   * thin.
   */
  deficit: number
  /** Bodies beyond the dedicated requirement, before flex is considered. */
  surplus: number
}

export type RosterNeed = {
  byPosition: PositionNeed[]
  /**
   * Flex slots left standing after every eligible surplus body is used.
   *
   * ⚠ COUNTED ACROSS FLEX SLOTS TOGETHER, NOT PER SLOT. A roster deep at wide
   * receiver has no flex need even with three empty FLEX slots, because those
   * receivers fill them. Treating each slot as its own hole is how a team gets
   * told to trade for a running back it does not need.
   */
  unfilledFlex: number
  /** Positions with a real hole, worst first. */
  holes: string[]
}

/**
 * What this roster cannot start.
 *
 * `rostered` is a position per player — the whole roster, not the lineup, since
 * the question is what they COULD start.
 */
export function computeRosterNeed(args: {
  requirements: SlotRequirements
  rostered: string[]
}): RosterNeed {
  const { requirements, rostered } = args

  const counts = new Map<string, number>()
  for (const raw of rostered) {
    const pos = String(raw).toUpperCase().trim()
    if (!pos) continue
    counts.set(pos, (counts.get(pos) ?? 0) + 1)
  }

  const byPosition: PositionNeed[] = []
  /** Bodies left over once dedicated slots are filled, available to flex. */
  const spare = new Map<string, number>()

  for (const [position, required] of requirements.dedicated) {
    const have = counts.get(position) ?? 0
    byPosition.push({
      position,
      required,
      have,
      deficit: Math.max(0, required - have),
      surplus: Math.max(0, have - required),
    })
    spare.set(position, Math.max(0, have - required))
  }

  /*
   * Positions with no dedicated slot are pure flex fodder — every body is
   * spare. A TE-less lineup with a REC_FLEX is the common case.
   */
  for (const [position, have] of counts) {
    if (!requirements.dedicated.has(position)) spare.set(position, have)
  }

  /*
   * Fill flex slots from the spare pool. Scarcest-eligibility slots first: a
   * SUPER_FLEX can take anything, so letting it draw before a REC_FLEX would
   * strand the narrower slot for no reason.
   */
  let unfilledFlex = 0
  const ordered = [...requirements.flex].sort((a, b) => a.eligible.length - b.eligible.length)
  for (const f of ordered) {
    const from = f.eligible.find((p) => (spare.get(p) ?? 0) > 0)
    if (from) spare.set(from, (spare.get(from) ?? 0) - 1)
    else unfilledFlex += 1
  }

  return {
    byPosition,
    unfilledFlex,
    holes: byPosition
      .filter((p) => p.deficit > 0)
      .sort((a, b) => b.deficit - a.deficit)
      .map((p) => p.position),
  }
}

/**
 * How much more this team should be willing to pay for a player at this
 * position, over the market price.
 *
 * ⚠ A DELIBERATELY NARROW BAND, AND IT IS A PREFERENCE, NOT A MEASUREMENT.
 * Nothing in this repo measures what managers actually overpay for need, so the
 * honest thing is a small stated premium that breaks ties and never overturns a
 * real value gap. A 40% "need multiplier" would let the engine recommend giving
 * up a materially better player, dressed as arithmetic.
 *
 * Returns null when the need could not be computed, so callers report absence
 * rather than a neutral 1.0 that looks like a finding.
 */
export const NEED_PREMIUM_PER_DEFICIT = 0.06
export const NEED_PREMIUM_CAP = 0.15
export const SURPLUS_DISCOUNT = 0.04

export function counterpartyPriceDelta(args: {
  position: string | null | undefined
  need: RosterNeed | null
}): { factor: number; basis: string } | null {
  const { position, need } = args
  if (!need || !position) return null

  const pos = position.toUpperCase().trim()
  const row = need.byPosition.find((p) => p.position === pos)

  /*
   * A position this league does not start at all. Not a gap — a real finding,
   * and a strong one: a kicker in a league with no K slot is worth nothing to
   * anybody in it.
   */
  if (!row && !need.byPosition.some((p) => p.position === pos)) {
    const flexOnly = need.unfilledFlex > 0
    if (!flexOnly) {
      return {
        factor: 1,
        basis: `no dedicated ${pos} slot in this lineup, so need does not move the price`,
      }
    }
  }

  if (row && row.deficit > 0) {
    const factor = 1 + Math.min(NEED_PREMIUM_CAP, row.deficit * NEED_PREMIUM_PER_DEFICIT)
    return {
      factor,
      basis: `they cannot fill ${row.deficit} ${pos} slot${row.deficit > 1 ? 's' : ''}, so a ${pos} is worth more to them`,
    }
  }

  if (row && row.surplus > 0) {
    return {
      factor: 1 - SURPLUS_DISCOUNT,
      basis: `they already start ${row.required} ${pos} and carry ${row.surplus} more, so another is worth slightly less to them`,
    }
  }

  return { factor: 1, basis: `their ${pos} slots are exactly filled` }
}
