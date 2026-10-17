/**
 * THE ROSTER-SPOT CHARGE — what an uneven deal costs in roster spots. PURE, client-safe.
 *
 * A 2-for-1 is not two assets for one: the side receiving two players must DROP one to make room, and
 * the side receiving one gains an open spot to fill from the waiver wire. Summing quoted prices ignores
 * that, so the side receiving more players always looked better than it was.
 *
 * ── Measured, not asserted (trade grade audit, 2026-10-09) ───────────────────────────────────────────
 * 447 real completed Sleeper trades since 2026-08-16, each priced on the FantasyCalc board captured the
 * day it happened. On the 196 with uneven player counts, the side receiving MORE players received a
 * median 7.9% more quoted value (63% of trades leaned that way) — managers pay to consolidate, and a
 * straight sum reads that premium as the depth side winning. Even-count trades showed no such lean.
 *
 * The charge that removes the lean is the chart value of the player at rank teams × roster spots — the
 * league's LAST rostered player, i.e. the waiver-wire level a dropped player falls to and an open spot
 * can be filled from. Fitted multiplier on that rank: 1.006 (bootstrap 90% interval 0.947–1.104), so the
 * rule uses the rank itself, with no tuning constant. It scales per extra player (2-for-1 lean 0.054 →
 * −0.012; 3-for-1 0.208 → 0.035), corrects dynasty (0.104 → −0.002) and barely moves redraft, which
 * was already centred (0.005 → 0.002). FantasyCalc publishes the same method (≈ the 300th player in an
 * average league). It changed the letter on 34% of the uneven trades sampled.
 *
 * ⚠ IT IS A MARKET RULE, NOT A ROSTER REVIEW. It assumes full rosters — a team with an empty spot drops
 * nobody — and that the waiver wire holds a last-roster-spot player. Which starter a deal actually
 * displaces is the roster-fit question, answered separately.
 */

/** Roster size assumed when a league states none: FantasyCalc's average league is ~26.7, the fit used 25. */
export const DEFAULT_ROSTER_SPOTS = 25

/** Slots that hold no active roster spot: injured reserve, taxi squads, devy rights. */
const NON_ROSTER_SLOTS = new Set(['IR', 'TAXI', 'RESERVE', 'RES', 'DEVY', 'IL', 'NA'])

/**
 * Active roster spots per team (starters + bench) from a league's settings, or null when it states none.
 * Reads Sleeper's `roster_positions` (one entry per spot) and the `NAME:count` form other importers write.
 */
export function rosterSpotsFromSettings(settings: unknown): number | null {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  if (!Array.isArray(s.roster_positions) || s.roster_positions.length === 0) return null
  let spots = 0
  for (const raw of s.roster_positions) {
    const entry = String(raw ?? '').trim().toUpperCase()
    if (!entry) continue
    const m = /^(.*?):(\d+)(?:-(\d+))?$/.exec(entry)
    const name = (m ? m[1] : entry).trim()
    const count = m ? Number(m[3] ?? m[2]) : 1
    if (!(count > 0) || NON_ROSTER_SLOTS.has(name)) continue
    spots += count
  }
  return spots > 0 ? spots : null
}

export type RosterSpotPrice = {
  /** The chart value of one open spot: the player at the league's last roster spot. */
  valuePerSpot: number
  /** That rank (teams × roster spots), and who sits there on today's chart. */
  rank: number
  atPlayer: string | null
  /** True when the league stated no roster size and DEFAULT_ROSTER_SPOTS was used. */
  rosterSpotsAssumed: boolean
}

/**
 * What one roster spot is worth on this chart. Picks are left out of the ranking (they hold no roster
 * spot). Past the end of a short chart (the redraft board lists ~225 players), the last listed player is
 * the floor — the same reading the fit used. Null when the chart lists no players.
 */
export function rosterSpotPrice(args: {
  chartPlayers: ReadonlyArray<{ name: string; value: number; position?: string | null }>
  teams: number
  rosterSpots: number | null
}): RosterSpotPrice | null {
  const ranked = args.chartPlayers
    .filter((p) => String(p.position ?? '').toUpperCase() !== 'PICK' && Number.isFinite(p.value) && p.value > 0)
    .slice()
    .sort((a, b) => b.value - a.value)
  if (ranked.length === 0) return null
  const teams = Number.isFinite(args.teams) && args.teams > 1 ? Math.round(args.teams) : 12
  const spots = args.rosterSpots ?? DEFAULT_ROSTER_SPOTS
  const rank = teams * spots
  const at = ranked[Math.min(ranked.length, rank) - 1]!
  return { valuePerSpot: at.value, rank, atPlayer: at.name, rosterSpotsAssumed: args.rosterSpots == null }
}

export type RosterSpotCredit = {
  /**
   * Whose RECEIVED total the credit joins, in the viewer's frame: 'give' when the partner receives fewer
   * players (the viewer's send side gains the open spot's value), 'get' when the viewer receives fewer.
   */
  side: 'give' | 'get'
  spots: number
  valuePerSpot: number
  value: number
}

/**
 * The credit for a deal: the side receiving FEWER players gains one open spot per player of difference,
 * each worth `valuePerSpot`. Null for an even player count or a spot worth nothing. Picks and FAAB are not
 * players and are not counted by the caller.
 */
export function rosterSpotCredit(args: { givePlayers: number; getPlayers: number; valuePerSpot: number }): RosterSpotCredit | null {
  const net = args.getPlayers - args.givePlayers
  if (net === 0 || !(args.valuePerSpot > 0)) return null
  const spots = Math.abs(net)
  return {
    // Viewer receives more players → the partner (who receives the viewer's `give`) gains the spots.
    side: net > 0 ? 'give' : 'get',
    spots,
    valuePerSpot: Math.round(args.valuePerSpot),
    value: Math.round(spots * args.valuePerSpot),
  }
}

export function rosterSpotLineName(credit: Pick<RosterSpotCredit, 'spots'>): string {
  return credit.spots === 1 ? 'Open roster spot' : `${credit.spots} open roster spots`
}

/**
 * The row a surface prints for the credit, under the total it joined. `viewer` frame: 'give' is what "you"
 * send; `teams` frame (the open analyzer): 'give' is what Team A sends, so Team B receives the credit.
 */
export function rosterSpotRowLabel(credit: Pick<RosterSpotCredit, 'side' | 'spots'>, frame: 'viewer' | 'teams'): string {
  const spots = credit.spots === 1 ? 'roster spot' : `${credit.spots} roster spots`
  if (frame === 'teams') {
    return credit.side === 'give'
      ? `Open ${spots} Team B gains (it receives fewer players)`
      : `Open ${spots} Team A gains (it receives fewer players)`
  }
  return credit.side === 'give'
    ? `The ${spots} you give up (you receive more players, so a full roster drops one)`
    : `The ${spots} you gain (you receive fewer players, so you can add one)`
}

/** The basis sentence: what was added, to whom, and where the number comes from. */
export function rosterSpotBasisSentence(credit: RosterSpotCredit, price: RosterSpotPrice): string {
  const who = credit.side === 'get' ? 'you receive fewer players, so your side' : 'they receive fewer players, so their side'
  const spots = credit.spots === 1 ? 'an open roster spot' : `${credit.spots} open roster spots`
  const where = price.atPlayer ? `, today ${price.atPlayer}` : ''
  const size = price.rosterSpotsAssumed ? ' (roster size not stated, 25 assumed)' : ''
  return `Includes ${credit.value} for ${spots}: ${who} gains room to add a player. One spot is worth the league’s last rostered player on this chart (rank ${price.rank}${where})${size}.`
}
