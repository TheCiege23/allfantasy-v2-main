/**
 * LeagueShape — the structural facts about a league that decide what a player is worth.
 *
 * PURE. No prisma, no fetch, no clock. Safe to import anywhere.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────
 * `normalizedPlayerValue` prices every league with one fixed table, `POSITION_SCARCITY`, tuned
 * for a 12-team 1-QB standard league. Measured against real leagues in this account:
 *
 *   Four Horsemen   4 teams · 4QB/4RB/6WR/4TE/10FLEX · 32 bench · 10 taxi · 10 IR
 *   KBFL           32 teams · 1QB/3RB/2WR/TE/K + IDP (DE/DL/LB/CB/DB) · dynasty PPR TEP
 *
 * That is an 8× spread in league size and a 4× spread in QB demand, priced identically. The
 * inputs to fix it are ALREADY on `CanonicalWorld` — `LeagueRosterSettingsFacts` carries
 * `starterSlots`, `rosterSize`, `irSlots`, `taxiSlots`; `LeagueTradeSettingsFacts` carries
 * `deadlineWeek`; team count is `world.teams.length`. Nothing new needs importing. They are lost
 * at the `ScoringContext` boundary, which is why this is plumbing before it is modelling.
 *
 * ── 🛑 THE ONE IDEA: SCARCITY IS LEAGUEWIDE STARTER DEMAND, NOT A CONSTANT ───────────────────
 * A position is scarce when the league forces managers to start more of it than the player pool
 * comfortably supplies. That is `teams × starters at the position`, and it is measurable:
 *
 *   QB in a 12-team 1QB league      12 × 1 = 12 startable QBs needed
 *   QB in Four Horsemen              4 × 4 = 16          ← MORE than the 12-team league
 *   QB in KBFL (32-team, 1QB)       32 × 1 = 32          ← more than double
 *
 * Note what that shows: Four Horsemen has FOUR teams and still needs more starting quarterbacks
 * than a standard twelve-team league. Neither team count nor slot count alone explains demand —
 * only the product does. Any model keyed on "is it superflex" cannot express this.
 */

/** Which positions can fill each slot. Mirrors `lib/core-app/slotEligibility.ts` deliberately. */
const SLOT_ELIGIBILITY: Record<string, readonly string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],
  DST: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  WRRB_WRT: ['RB', 'WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  SUPERFLEX: ['QB', 'RB', 'WR', 'TE'],
  SF: ['QB', 'RB', 'WR', 'TE'],
  LB: ['LB'],
  ILB: ['LB'],
  OLB: ['LB'],
  DL: ['DL'],
  DE: ['DL'],
  DT: ['DL'],
  DB: ['DB'],
  CB: ['DB'],
  S: ['DB'],
  SS: ['DB'],
  FS: ['DB'],
  IDP_FLEX: ['LB', 'DL', 'DB'],
}

export interface FlexGroup {
  count: number
  eligible: readonly string[]
}

export interface LeagueShape {
  /** Number of teams. NEVER defaulted to 12 — see {@link buildLeagueShape}. */
  teams: number
  /** The league's own `roster_positions`, verbatim and uppercased. */
  starterSlots: readonly string[]
  /** Slots that name exactly one position. `{ QB: 4, RB: 4, WR: 6, TE: 4 }` for Four Horsemen. */
  dedicatedStarters: Readonly<Record<string, number>>
  /** Multi-position slots, grouped by their eligibility set. */
  flexGroups: readonly FlexGroup[]
  /** Flex slots a QB may fill. Superflex is `> 0`; a 1-QB league with 2 FLEX is `0`. */
  superflexSlots: number
  /** Every starting slot, dedicated and flex. */
  totalStarters: number
  rosterSize: number | null
  /** rosterSize − totalStarters, when rosterSize is known. Excludes taxi and IR. */
  benchSlots: number | null
  irSlots: number | null
  taxiSlots: number | null
  /** Last week trades may process. Null when unknown — NOT "no deadline". */
  deadlineWeek: number | null
}

export interface BuildLeagueShapeInput {
  teams: number
  starterSlots: readonly string[] | null | undefined
  rosterSize?: number | null
  irSlots?: number | null
  taxiSlots?: number | null
  deadlineWeek?: number | null
}

/**
 * Build a `LeagueShape`, or return null.
 *
 * 🛑 RETURNS NULL RATHER THAN DEFAULTING. `captureSnapshot.ts` writes `leagueSize = seasonRosterCount
 * || 12` and `buildTeamProfile` takes `leagueSize ?? 12`. For Four Horsemen that is a 3× error and
 * for KBFL a 2.7× error in the opposite direction, and neither is visible — the number still looks
 * like a number. A caller that cannot supply a real team count must get an honest null and fall
 * back to the existing fixed-table behaviour, which is at least a KNOWN approximation.
 */
export function buildLeagueShape(input: BuildLeagueShapeInput): LeagueShape | null {
  if (!Number.isFinite(input.teams) || input.teams < 2) return null
  const slots = (input.starterSlots ?? []).map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean)
  if (slots.length === 0) return null

  const dedicated: Record<string, number> = {}
  const flexByKey = new Map<string, FlexGroup>()
  let superflexSlots = 0
  let totalStarters = 0

  for (const slot of slots) {
    const eligible = SLOT_ELIGIBILITY[slot]
    // An unrecognised slot is NOT a starter. BN/IR/TAXI land here, which is why they are not counted.
    if (!eligible) continue
    totalStarters += 1

    if (eligible.length === 1) {
      dedicated[eligible[0]] = (dedicated[eligible[0]] ?? 0) + 1
      continue
    }
    const key = [...eligible].sort().join('|')
    const existing = flexByKey.get(key)
    if (existing) flexByKey.set(key, { count: existing.count + 1, eligible: existing.eligible })
    else flexByKey.set(key, { count: 1, eligible })
    if (eligible.includes('QB')) superflexSlots += 1
  }

  if (totalStarters === 0) return null

  const rosterSize = Number.isFinite(input.rosterSize as number) ? (input.rosterSize as number) : null
  const benchSlots = rosterSize != null ? Math.max(0, rosterSize - totalStarters) : null

  return {
    teams: Math.round(input.teams),
    starterSlots: slots,
    dedicatedStarters: dedicated,
    flexGroups: [...flexByKey.values()],
    superflexSlots,
    totalStarters,
    rosterSize,
    benchSlots,
    irSlots: Number.isFinite(input.irSlots as number) ? (input.irSlots as number) : null,
    taxiSlots: Number.isFinite(input.taxiSlots as number) ? (input.taxiSlots as number) : null,
    deadlineWeek: Number.isFinite(input.deadlineWeek as number) ? (input.deadlineWeek as number) : null,
  }
}

/**
 * Starting slots at a position across the whole league, counting a share of every flex a player
 * at that position is eligible for.
 *
 * ⚠ FLEX IS SPLIT EVENLY ACROSS ITS ELIGIBLE POSITIONS, AND THAT IS AN APPROXIMATION, NOT A
 * MEASUREMENT. `starterNeedsFromSlots` refuses to split flex at all — "a requirement without an
 * address" — and that refusal is right when it is deciding whether a ROSTER is short at a
 * position, because a specific team really does need a specific body.
 *
 * This function answers a different question: how much leaguewide DEMAND exists for the position.
 * There, refusing to split throws away the largest block of demand in a league like Four Horsemen,
 * where 10 of 28 starters are flex — 36% of the lineup would count for nothing. An even split is
 * a stated approximation; ignoring it is a silent understatement.
 *
 * In practice flex skews toward RB and WR over TE. That skew is deliberately NOT modelled here:
 * it varies by scoring (a TE-premium league pushes TEs into flex) and inventing a weight would be
 * exactly the kind of unmeasured constant this codebase keeps getting burned by. Even is honest
 * and wrong in a knowable direction; weighted is wrong in an unknowable one.
 */
export function leaguewideStarters(shape: LeagueShape, position: string): number {
  const pos = String(position ?? '').trim().toUpperCase()
  if (!pos) return 0

  let perTeam = shape.dedicatedStarters[pos] ?? 0
  for (const group of shape.flexGroups) {
    if (group.eligible.includes(pos)) perTeam += group.count / group.eligible.length
  }
  return perTeam * shape.teams
}

/**
 * The reference league every `POSITION_SCARCITY` value was tuned against: 12 teams, 1 QB, 2 RB,
 * 2 WR, 1 TE, 1 FLEX, K, DEF. Used as the denominator so a shape-aware multiplier is exactly 1.0
 * for that league and the existing table keeps its meaning.
 */
export const REFERENCE_SHAPE: LeagueShape = {
  teams: 12,
  starterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
  dedicatedStarters: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 },
  flexGroups: [{ count: 1, eligible: ['RB', 'WR', 'TE'] }],
  superflexSlots: 0,
  totalStarters: 9,
  rosterSize: 15,
  benchSlots: 6,
  irSlots: null,
  taxiSlots: null,
  deadlineWeek: null,
}

/**
 * How much scarcer this position is here than in the reference league, as a multiplier.
 *
 * demandRatio = leaguewideStarters(shape, pos) / leaguewideStarters(REFERENCE_SHAPE, pos)
 *
 * Then damped: `ratio ** DEMAND_EXPONENT`. Demand is real but value is not linear in it — doubling
 * the number of startable quarterbacks required does not double what one is worth, because the
 * replacement quarterback is worse but not worthless. The exponent is the one free parameter here
 * and it is stated, bounded and testable rather than buried.
 *
 * Returns 1.0 exactly when the position's demand matches the reference, so a standard 12-team
 * league is byte-identical to the pre-shape behaviour.
 */
export const DEMAND_EXPONENT = 0.5
export const DEMAND_MULTIPLIER_MIN = 0.5
export const DEMAND_MULTIPLIER_MAX = 2.5

export function demandMultiplier(shape: LeagueShape | null | undefined, position: string): number {
  if (!shape) return 1.0
  const here = leaguewideStarters(shape, position)
  const reference = leaguewideStarters(REFERENCE_SHAPE, position)
  // A position the reference league does not start (LB, DL, DB) has no baseline to compare
  // against. Returning 1.0 leaves IDP to `idpValue`, which is already league-derived and correct.
  if (reference <= 0 || here <= 0) return 1.0

  const raw = Math.pow(here / reference, DEMAND_EXPONENT)
  return Math.min(DEMAND_MULTIPLIER_MAX, Math.max(DEMAND_MULTIPLIER_MIN, raw))
}

/**
 * Total rostered players leaguewide — `teams × rosterSize`. The blunt measure of how deep the
 * player pool is drained, and therefore how bad the best free agent is.
 *
 * Null when `rosterSize` is unknown, because a guess here would silently mis-price every asset in
 * the league rather than declining to adjust.
 */
export function rosteredPlayers(shape: LeagueShape): number | null {
  return shape.rosterSize == null ? null : shape.teams * shape.rosterSize
}

/** True when trades can no longer process in `week`. Unknown deadline ⇒ false, never assumed closed. */
export function isPastTradeDeadline(shape: LeagueShape, week: number | null | undefined): boolean {
  if (shape.deadlineWeek == null || week == null || !Number.isFinite(week)) return false
  return week > shape.deadlineWeek
}

/**
 * Free stash capacity — taxi plus IR. A rookie stashed on a 10-man taxi squad costs its owner
 * nothing; the same rookie on a 6-man bench costs a roster spot that could hold a contributor.
 * Null when neither is known.
 */
export function stashCapacity(shape: LeagueShape): number | null {
  if (shape.irSlots == null && shape.taxiSlots == null) return null
  return (shape.irSlots ?? 0) + (shape.taxiSlots ?? 0)
}
