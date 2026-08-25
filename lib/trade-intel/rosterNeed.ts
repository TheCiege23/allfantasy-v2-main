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

/** One rostered player, as the need model sees him. */
export type RosteredSlot = {
  position: string
  /**
   * Declared absent — out, IR, suspended, PUP. NOT questionable or doubtful.
   *
   * ⚠ A BODY ON IR DOES NOT FILL A SLOT. Counting him would report a team whose
   * only kicker is on injured reserve as having no kicker need, which is the
   * exact case where the need is most real and most expensive.
   */
  unavailable?: boolean
}

/**
 * What this roster cannot start.
 *
 * `rostered` is the whole roster, not the lineup, since the question is what
 * they COULD start. Plain strings are accepted for the common case where
 * availability is unknown; they are treated as available, because inventing
 * absence out of missing data overstates need.
 */
export function computeRosterNeed(args: {
  requirements: SlotRequirements
  rostered: Array<string | RosteredSlot>
}): RosterNeed {
  const { requirements, rostered } = args

  const counts = new Map<string, number>()
  for (const raw of rostered) {
    const slot: RosteredSlot = typeof raw === 'string' ? { position: raw } : raw
    if (slot.unavailable) continue
    const pos = String(slot.position).toUpperCase().trim()
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
 * ⚠ A NEED IS ONLY EXPENSIVE IF THE REPLACEMENT IS SCARCE. Two identical
 * rosters, identical scoring, identical slots — one manager's kicker is on IR.
 * If a dozen kickers sit on waivers, that manager's "need" costs them a waiver
 * claim and nothing else, and a trade for one should be priced accordingly. If
 * the wire is empty, a trade is the ONLY way to fill the slot, and the same
 * kicker is worth a great deal more to them than to the manager beside them
 * whose kicker is healthy. The need is identical in both cases; the price is
 * not, and the difference is entirely the availability of the alternative.
 *
 * ⚠ STILL A PREFERENCE, NOT A MEASUREMENT. Nothing here measures what managers
 * actually overpay. What scarcity does is decide WHICH stated band applies, and
 * that decision is made on counted free agents rather than on a feeling.
 *
 * The premium is a multiplier on the player's OWN value, which is what keeps it
 * safe. Sixty percent of a kicker is still a kicker; it can reorder a close
 * deal and it cannot manufacture a star.
 *
 * Returns null when the need could not be computed, so callers report absence
 * rather than a neutral 1.0 that looks like a finding.
 */
export const NEED_PREMIUM_PER_DEFICIT = 0.06
/** Cap when the position can simply be replaced off waivers. */
export const NEED_PREMIUM_CAP = 0.15
/** Cap when nothing at the position is available anywhere. */
export const SCARCE_PREMIUM_CAP = 0.6
export const SURPLUS_DISCOUNT = 0.04

/**
 * How hard this position is to fill without trading, from 0 (walk to the waiver
 * wire) to 1 (nothing exists). Null means we did not look — callers then use
 * the replaceable band, which is the conservative direction.
 */
export type Scarcity = { position: string; freeAgents: number; scarcity: number } | null

export function counterpartyPriceDelta(args: {
  position: string | null | undefined
  need: RosterNeed | null
  /** Availability at this position in this league. Omitted = assume replaceable. */
  scarcity?: Scarcity
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
    /*
     * Scarcity picks the band. Unknown scarcity uses the replaceable cap, which
     * understates rather than overstates — the safe direction when we have not
     * actually checked the waiver wire.
     */
    const sc = args.scarcity && args.scarcity.position === pos ? args.scarcity.scarcity : null
    const cap =
      sc == null ? NEED_PREMIUM_CAP : NEED_PREMIUM_CAP + (SCARCE_PREMIUM_CAP - NEED_PREMIUM_CAP) * sc
    const raw = row.deficit * NEED_PREMIUM_PER_DEFICIT * (sc == null ? 1 : 0.5 + sc * 2)
    const factor = 1 + Math.min(cap, raw)

    const slots = `${row.deficit} ${pos} slot${row.deficit > 1 ? 's' : ''}`
    const where =
      sc == null
        ? ''
        : args.scarcity!.freeAgents === 0
          ? ` and there is no ${pos} available on waivers, so a trade is the only way to fill it`
          : sc > 0.5
            ? ` and only ${args.scarcity!.freeAgents} ${pos}${args.scarcity!.freeAgents === 1 ? ' is' : ' are'} unrostered`
            : ` — though ${args.scarcity!.freeAgents} are on waivers, so this is a claim away`
    return { factor, basis: `they cannot fill ${slots}${where}` }
  }

  if (row && row.surplus > 0) {
    return {
      factor: 1 - SURPLUS_DISCOUNT,
      basis: `they already start ${row.required} ${pos} and carry ${row.surplus} more, so another is worth slightly less to them`,
    }
  }

  return { factor: 1, basis: `their ${pos} slots are exactly filled` }
}

/* ── Bye-week collision ────────────────────────────────────────────────────
 *
 * ⚠ A BYE DOES NOT CHANGE WHAT A PLAYER IS WORTH. It changes what a specific
 * TRADE is worth to a specific team, which is why this sits in layer 5 beside
 * roster need and not in the situation layer. Josh Allen is the same asset to
 * everyone; acquiring him is a different proposition if your other quarterback
 * is already off in week 10 and you have not noticed.
 *
 * ⚠ AND IT MUST NOT VETO A TRADE. Two years of a quarterback of that calibre
 * can be worth one unstartable Sunday, and that judgement belongs to the
 * manager. The job here is to make sure they are making it on purpose — the
 * sentence is the deliverable, the small price nudge is not.
 */

export type ByeShortfall = {
  week: number
  position: string
  /** Startable bodies at the position that week. */
  available: number
  required: number
  shortfall: number
}

/**
 * Weeks this roster cannot fill its dedicated slots because of byes.
 *
 * Flex is deliberately ignored here. A flex hole is a downgrade; an empty
 * dedicated slot is a zero, and conflating the two would bury the case that
 * actually costs a manager a week.
 *
 * Players with an unknown bye are counted as AVAILABLE. Treating unknown as
 * "off" would invent collisions out of missing data, and a false alarm on a
 * trade screen is worse than a missed one — it teaches managers to ignore it.
 */
export function byeShortfalls(args: {
  requirements: SlotRequirements
  roster: Array<{ position: string; byeWeek: number | null }>
}): ByeShortfall[] {
  const { requirements, roster } = args
  const out: ByeShortfall[] = []

  const weeks = new Set<number>()
  for (const p of roster) if (p.byeWeek != null) weeks.add(p.byeWeek)

  for (const week of [...weeks].sort((a, b) => a - b)) {
    for (const [position, required] of requirements.dedicated) {
      const atPosition = roster.filter((p) => p.position.toUpperCase().trim() === position)
      /*
       * ⚠ A BYE HOLE IS ONLY A BYE HOLE IF THE BODIES EXIST. A roster that
       * simply has no kicker is short one every week of the season, and that is
       * a roster-construction fact, not something a trade's bye weeks caused.
       * Reporting it here would fire this warning on every deal a thin roster
       * ever looked at, which is how a real signal gets trained away.
       */
      if (atPosition.length < required) continue
      const available = atPosition.filter((p) => p.byeWeek !== week).length
      if (available < required) {
        out.push({ week, position, available, required, shortfall: required - available })
      }
    }
  }
  return out
}

/** How much a bye collision should move the price of one deal, and what to say. */
export const BYE_COLLISION_DISCOUNT = 0.03
export const BYE_COLLISION_CAP = 0.09

export type ByeCollision = {
  factor: number
  basis: string
  /** Weeks this trade would newly break. */
  created: ByeShortfall[]
  /**
   * Weeks already broken that this trade had a chance to fix and does not,
   * because the incoming player is off in the same week as the hole.
   *
   * \u26a0 NOT THE SAME AS BREAKING IT, and priced differently. The manager is no
   * worse off than before \u2014 they are just no better off, at a position they
   * were presumably trading to improve. Worth a sentence; not worth a discount
   * on top of one they are already paying.
   */
  unrelieved: ByeShortfall[]
}

/**
 * What a specific deal does to the acquiring roster's bye weeks.
 *
 * \u26a0 BOTH SIDES, BECAUSE A TRADE IS NOT AN ACQUISITION. Receiving a
 * quarterback while sending one away can turn a covered week into an empty one,
 * and a model that only looks at the incoming player cannot see it. That is the
 * exact case worth catching: you send the QB2 who was covering week 10 and
 * receive one who is also off in week 10.
 *
 * Returns null when the lineup or the bye is unknown \u2014 unknown byes are treated
 * as available everywhere, because inventing a collision out of missing data is
 * a false alarm, and false alarms on a trade screen teach managers to ignore it.
 */
export function byeCollisionDelta(args: {
  requirements: SlotRequirements | null
  /** The acquiring roster as it stands today. */
  roster: Array<{ position: string; byeWeek: number | null; id?: string }>
  /** The player they would be receiving. */
  incoming: { position: string | null; byeWeek: number | null }
  /** Anything leaving in the same deal, by the same id used on `roster`. */
  outgoingIds?: string[]
}): ByeCollision | null {
  const { requirements, roster, incoming } = args
  if (!requirements || !incoming.position || incoming.byeWeek == null) return null

  const pos = incoming.position.toUpperCase().trim()
  const out = new Set(args.outgoingIds ?? [])

  const before = byeShortfalls({ requirements, roster })
  const after = byeShortfalls({
    requirements,
    roster: [
      ...roster.filter((p) => !p.id || !out.has(p.id)),
      { position: pos, byeWeek: incoming.byeWeek },
    ],
  })

  const key = (x: ByeShortfall) => `${x.week}:${x.position}`
  const beforeBy = new Map(before.map((x) => [key(x), x.shortfall]))

  /*
   * Only shortfalls this deal creates or deepens. A hole the roster already had
   * is not this trade's fault, and charging for it would penalise the one move
   * that might fix it.
   */
  const created = after.filter((x) => x.shortfall > (beforeBy.get(key(x)) ?? 0))

  /*
   * The Josh Allen case. The week was already broken, the incoming player is at
   * the position that would have fixed it, and he is off that same week \u2014 so
   * the deal quietly fails to solve the thing it looks like it solves.
   */
  const unrelieved = created.length
    ? []
    : after.filter(
        (x) =>
          x.position === pos &&
          x.week === incoming.byeWeek &&
          (beforeBy.get(key(x)) ?? 0) > 0,
      )

  if (created.length === 0 && unrelieved.length === 0) {
    return { factor: 1, basis: 'no bye-week problem either way', created: [], unrelieved: [] }
  }

  if (created.length > 0) {
    const worst = created[0]!
    return {
      factor: 1 - Math.min(BYE_COLLISION_CAP, created.length * BYE_COLLISION_DISCOUNT),
      basis: `this opens a week ${worst.week} hole \u2014 you would have ${worst.available} startable ${worst.position} for ${worst.required} slot${worst.required > 1 ? 's' : ''}`,
      created,
      unrelieved: [],
    }
  }

  const w = unrelieved[0]!
  return {
    /*
     * No discount. They are not worse off than before the trade, and they may
     * well take it anyway \u2014 two years of a player of that calibre is worth one
     * unstartable Sunday. The sentence is the whole deliverable here.
     */
    factor: 1,
    basis: `heads up: he is off in week ${w.week}, the same week you already have no startable ${w.position} \u2014 this deal does not fix that`,
    created: [],
    unrelieved,
  }
}
