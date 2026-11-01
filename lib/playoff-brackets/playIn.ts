/**
 * PLAYOFF PLAY-IN WEEK — the last playoff spot (or the last two) decided in a game the week before
 * the playoffs proper, between the teams just inside and just outside the cut.
 *
 *   one spot     #N plays #N+1; the winner is the #N seed
 *   two spots    #N-1 plays #N+2 and #N plays #N+1 (best vs worst)
 *
 * A play-in IS a bye plan (./byePlan.ts), so the bracket engine runs it as one with nothing new:
 * every seed above the play-in waits one round longer than in the normal N-team bracket, and the
 * play-in seeds play round 1. For six teams and one spot that is seven seeds with
 * `[2, 2, 1, 1, 1, 0, 0]`: #6 v #7 in week 1, then the usual six-team bracket. It adds one playoff
 * week, which the bracket card checks against the season like any plan.
 *
 * Because it is stored as the plan alone, `detectPlayIn` recognises one from what is saved — the
 * round names, the settings card and the standings screen all read it from there, so there is no
 * second setting to keep in step. Like every commissioner-granted bye plan it is AF Commissioner
 * (`advanced_playoff_setup`), enforced where every plan is saved.
 *
 * Pure.
 */
import { MAX_PLAYOFF_TEAMS, checkByePlan, naturalByePlan } from './byePlan'

export const PLAY_IN_SPOT_OPTIONS = [1, 2] as const
export type PlayInSpots = (typeof PLAY_IN_SPOT_OPTIONS)[number]

export type PlayIn = {
  /** Teams in the playoffs proper. */
  qualifiers: number
  /** Playoff spots decided in the play-in. */
  spots: PlayInSpots
  /** Seeds in the bracket, play-in teams included. */
  seeds: number
  plan: number[]
  /** The play-in games, best seed first. */
  games: Array<[number, number]>
}

/**
 * The play-in for `qualifiers` playoff teams with `spots` decided by it, or null when that does not
 * make a bracket: more than 16 seeds, or a play-in reaching into the seeds that earned a bye.
 */
export function playInFor(qualifiers: number, spots: number): PlayIn | null {
  if (!(PLAY_IN_SPOT_OPTIONS as readonly number[]).includes(spots)) return null
  if (!Number.isInteger(qualifiers) || qualifiers < 2) return null
  const seeds = qualifiers + spots
  if (seeds > MAX_PLAYOFF_TEAMS) return null
  const natural = naturalByePlan(qualifiers)
  const firstPlayIn = qualifiers - spots // 0-based index of the best play-in seed
  // At least one seed stands above the play-in (or it is just a bigger bracket), and a seed that
  // earned a bye in the normal bracket is never sent to it.
  if (firstPlayIn < 1 || natural.slice(firstPlayIn).some((off) => off > 0)) return null
  const plan = Array.from({ length: seeds }, (_, i) => (i < firstPlayIn ? natural[i] + 1 : 0))
  if (!checkByePlan(seeds, plan).ok) return null
  const playing = Array.from({ length: 2 * spots }, (_, i) => firstPlayIn + 1 + i)
  const games = Array.from({ length: spots }, (_, i) => [playing[i], playing[playing.length - 1 - i]] as [number, number])
  return { qualifiers, spots: spots as PlayInSpots, seeds, plan, games }
}

/** The play-in a saved bracket is, or null when it is some other plan (or none). */
export function detectPlayIn(seeds: number, plan: readonly number[] | null | undefined): PlayIn | null {
  if (!plan || plan.length !== seeds) return null
  for (const spots of PLAY_IN_SPOT_OPTIONS) {
    const p = playInFor(seeds - spots, spots)
    if (p && p.plan.length === plan.length && p.plan.every((v, i) => v === plan[i])) return p
  }
  return null
}

/** The play-in options a commissioner can pick for `qualifiers` playoff teams. */
export function playInOptions(qualifiers: number): PlayIn[] {
  return PLAY_IN_SPOT_OPTIONS.map((s) => playInFor(qualifiers, s)).filter((p): p is PlayIn => p !== null)
}
