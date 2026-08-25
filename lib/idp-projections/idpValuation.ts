/**
 * IDP valuation — replacement level and value over it, from this league's own numbers.
 *
 * WHY THIS IS A DIFFERENT CONSTRUCTION FROM THE OFFENSIVE SIDE, AND MUST BE LABELLED AS ONE.
 * Offensive value in this codebase is anchored to FantasyCalc's market. FantasyCalc does not
 * price individual defenders at all, so there is no anchor to hang an IDP value on. Everything
 * here is therefore built from two things we can actually compute: what the league projects a
 * player to score, and how many players at his position the league forces every team to start.
 *
 * ⚠ REPLACEMENT LEVEL IS THE WHOLE GAME, AND IT IS A PROPERTY OF THE LEAGUE, NOT THE PLAYER.
 * In a league starting three linebackers from a 32-team pool, LB18 is close to free — someone
 * equivalent is sitting on waivers. In one starting six, the same player is a locked-in
 * starter and there is nothing behind him. Any IDP value that does not read
 * `roster_positions` is pricing a league nobody is in, which is the same failure a generic PPR
 * projection makes.
 *
 * What this deliberately does NOT do is invent a market. It returns points over replacement
 * and the evidence behind it; converting that into a tradeable currency is a separate decision
 * with its own scale, and mixing the two would bury a modelling choice inside an arithmetic
 * one.
 *
 * Pure: no prisma, no fetch, no clock.
 */

import { normalizeIdpPosition } from '@/lib/idp-kicker-values'

/** The three groups Sleeper actually rosters defenders as. */
export type IdpGroup = 'LB' | 'DL' | 'DB'

/**
 * Which groups can fill a given roster slot.
 *
 * ⚠ SPECIFIC SLOTS ARE NOT THEIR OWN POOL. A league that starts `DE` is asking for a
 * defensive lineman; treating `DE` as a fourth group would compute a replacement level from a
 * handful of players and price every edge rusher as irreplaceable. Sleeper's own position
 * vocabulary collapses to LB/DL/DB and so does this.
 */
const SLOT_ELIGIBILITY: Record<string, readonly IdpGroup[]> = {
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

export interface IdpValuationPlayer {
  playerId: string
  position: string | null | undefined
  /** Points per game under THIS league's scoring. Null means unprojected, not zero. */
  projectedPoints: number | null
}

export interface IdpReplacementLevel {
  group: IdpGroup
  /** Starting slots this league forces across every team, dedicated plus flex actually used. */
  startersLeagueWide: number
  /** Points per game of the best player NOT holding a starting slot. Null when the pool ran out. */
  replacementPoints: number | null
  /** The player that level came from, so the number can be checked rather than trusted. */
  replacementPlayerId: string | null
  /** How many projected players existed at this group. The denominator behind the level. */
  pool: number
}

export interface IdpValuationResult {
  playerId: string
  group: IdpGroup
  projectedPoints: number
  replacementPoints: number | null
  /**
   * Points per game above the best freely available player at his position.
   *
   * Null — never zero — when replacement could not be established. A zero here would claim
   * the player is exactly replaceable, which is a real and different statement.
   */
  vorp: number | null
  /** Rank among projected players at his group in this league. */
  positionRank: number
  /** True when he is inside the league's starting requirement at his position. */
  isStarter: boolean
}

export interface IdpValuationRefusal {
  ok: false
  reason: 'not_an_idp_league' | 'no_projected_defenders' | 'no_team_count'
  detail: string
}

export interface IdpValuationSuccess {
  ok: true
  /** One entry per projected defender, richest first is NOT guaranteed — key by playerId. */
  players: IdpValuationResult[]
  replacement: Record<IdpGroup, IdpReplacementLevel>
  /** Slots parsed out of `roster_positions`, for the reader to check against their league. */
  slots: { dedicated: Record<IdpGroup, number>; flex: number }
  numTeams: number
  /**
   * True statements about the construction. Always says the value is projection-and-scarcity
   * driven with no market anchor, because a reader comparing it to a FantasyCalc number for a
   * wide receiver is comparing two things built differently.
   */
  notes: string[]
}

export type IdpValuationOutcome = IdpValuationSuccess | IdpValuationRefusal

const NO_MARKET_ANCHOR_NOTE =
  'FantasyCalc does not price individual defenders, so this value has no market anchor. It is ' +
  'built entirely from this league’s own projections and its own starting requirements, ' +
  'which is a different construction from the offensive values beside it.'

/** Count IDP starting slots by group, plus flex slots that any defender can fill. */
export function parseIdpSlots(rosterSlots: readonly string[] | null | undefined): {
  dedicated: Record<IdpGroup, number>
  flex: number
} {
  const dedicated: Record<IdpGroup, number> = { LB: 0, DL: 0, DB: 0 }
  let flex = 0
  for (const raw of rosterSlots ?? []) {
    const slot = String(raw ?? '').trim().toUpperCase()
    const eligible = SLOT_ELIGIBILITY[slot]
    if (!eligible) continue
    if (eligible.length > 1) flex++
    else dedicated[eligible[0]]++
  }
  return { dedicated, flex }
}

export interface BuildIdpValuationsInput {
  players: readonly IdpValuationPlayer[]
  /** `roster_positions` from the league, bench slots included or not — both are handled. */
  rosterSlots: readonly string[] | null | undefined
  numTeams: number
}

/**
 * Replacement level by simulated draft, not by an assumed flex split.
 *
 * ⚠ NO INVENTED SHARES. `lib/vorp-engine.ts` splits flex slots with hardcoded constants
 * (RB 40% / WR 40% / TE 20%). That is a guess standing in for a calculation, and it is exactly
 * the guess this can avoid: fill every dedicated slot from the projection ranking, then hand
 * each flex slot to whichever remaining defender is actually projected highest. Where the flex
 * slots land is then an OUTPUT of the projections rather than an assumption imposed on them.
 */
export function buildIdpValuations(input: BuildIdpValuationsInput): IdpValuationOutcome {
  const numTeams = Math.floor(input.numTeams)
  if (!Number.isFinite(numTeams) || numTeams <= 0) {
    return {
      ok: false,
      reason: 'no_team_count',
      detail: 'A league team count is required; replacement level is meaningless without it.',
    }
  }

  const slots = parseIdpSlots(input.rosterSlots)
  const totalIdpSlots = slots.dedicated.LB + slots.dedicated.DL + slots.dedicated.DB + slots.flex
  if (totalIdpSlots === 0) {
    return {
      ok: false,
      reason: 'not_an_idp_league',
      detail: 'No IDP starting slots in roster_positions, so defenders have no replacement level here.',
    }
  }

  /* Only projected players can be ranked. An unprojected defender is absent from the pool, not
   * placed at the bottom of it — ranking him last would price him as the worst player in the
   * league on the strength of a data gap. */
  const byGroup: Record<IdpGroup, Array<{ playerId: string; points: number }>> = {
    LB: [],
    DL: [],
    DB: [],
  }
  for (const p of input.players) {
    const group = normalizeIdpPosition(String(p.position ?? '')) as IdpGroup | null
    if (!group || !byGroup[group]) continue
    if (typeof p.projectedPoints !== 'number' || !Number.isFinite(p.projectedPoints)) continue
    byGroup[group].push({ playerId: p.playerId, points: p.projectedPoints })
  }
  for (const g of Object.keys(byGroup) as IdpGroup[]) {
    byGroup[g].sort((a, b) => b.points - a.points)
  }

  const pool = byGroup.LB.length + byGroup.DL.length + byGroup.DB.length
  if (pool === 0) {
    return {
      ok: false,
      reason: 'no_projected_defenders',
      detail: 'No defender in the supplied pool carried a projection, so nothing can be ranked.',
    }
  }

  // --- fill dedicated slots, then flex, from the projection ranking --------------------
  const taken: Record<IdpGroup, number> = { LB: 0, DL: 0, DB: 0 }
  for (const g of ['LB', 'DL', 'DB'] as IdpGroup[]) {
    taken[g] = Math.min(byGroup[g].length, slots.dedicated[g] * numTeams)
  }

  let flexRemaining = slots.flex * numTeams
  while (flexRemaining > 0) {
    let bestGroup: IdpGroup | null = null
    let bestPoints = -Infinity
    for (const g of ['LB', 'DL', 'DB'] as IdpGroup[]) {
      const next = byGroup[g][taken[g]]
      if (next && next.points > bestPoints) {
        bestPoints = next.points
        bestGroup = g
      }
    }
    // The pool is exhausted before the league's slots are — a real outcome in a thin import.
    if (!bestGroup) break
    taken[bestGroup]++
    flexRemaining--
  }

  const replacement = {} as Record<IdpGroup, IdpReplacementLevel>
  for (const g of ['LB', 'DL', 'DB'] as IdpGroup[]) {
    const next = byGroup[g][taken[g]] ?? null
    replacement[g] = {
      group: g,
      startersLeagueWide: taken[g],
      replacementPoints: next ? next.points : null,
      replacementPlayerId: next ? next.playerId : null,
      pool: byGroup[g].length,
    }
  }

  const players: IdpValuationResult[] = []
  for (const g of ['LB', 'DL', 'DB'] as IdpGroup[]) {
    byGroup[g].forEach((p, i) => {
      const rep = replacement[g].replacementPoints
      players.push({
        playerId: p.playerId,
        group: g,
        projectedPoints: p.points,
        replacementPoints: rep,
        vorp: rep == null ? null : Math.round((p.points - rep) * 100) / 100,
        positionRank: i + 1,
        isStarter: i < taken[g],
      })
    })
  }

  const notes = [NO_MARKET_ANCHOR_NOTE]
  notes.push(
    `This league starts ${slots.dedicated.LB} LB, ${slots.dedicated.DL} DL, ` +
      `${slots.dedicated.DB} DB and ${slots.flex} IDP flex per team across ${numTeams} teams.`,
  )
  for (const g of ['LB', 'DL', 'DB'] as IdpGroup[]) {
    const r = replacement[g]
    if (r.startersLeagueWide === 0) continue
    if (r.replacementPoints == null) {
      notes.push(
        `Every projected ${g} is a starter somewhere in this league, so there is no replacement ` +
          `level to measure against — ${r.pool} projected for ${r.startersLeagueWide} slots.`,
      )
    }
  }

  return { ok: true, players, replacement, slots, numTeams, notes }
}
