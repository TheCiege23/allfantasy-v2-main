/**
 * Guilly survival outlook (owner's ask, 2026-11-24): for every team still alive, how many starters still
 * have a game to play this week, how many games that is, what those games are projected to add — and from
 * that, each team's chance of surviving the chop.
 *
 * Pure. The loader is ./survivalOutlookLoad.ts (schedule, lineups, AF projections); the board reads it via
 * ./survivalBoardModel.ts.
 *
 * HOW "% SAFE" IS MADE, AND WHAT IT IS NOT
 *   Each team finishes at (score so far) + (projection for the games it has left). A team's remaining
 *   points vary around that projection with a spread proportional to it (SPREAD), so a team with nothing
 *   left to play has a fixed finish and a team with a full week left has the widest. The week is played
 *   SIMS times with a seeded generator (the same input always gives the same percentage), the lowest
 *   `chopCount` teams that are not immune are chopped each time, and "% safe" is the share of weeks a team
 *   survives. It is a projection, not a promise: it knows nothing a projection does not.
 */

export type StarterGames = {
  /** This week's AF projection for the player in this league's scoring; null when there is none. */
  weekProjection: number | null
  /** Games his team plays this week, and how many of them are not final yet. */
  gamesThisWeek: number
  gamesLeft: number
}

export type TeamOutlook = {
  /** Starters with at least one game still to play this week. */
  playersLeft: number
  starters: number
  /** Games those starters still have, added up (a daily sport plays several per player). */
  gamesLeft: number
  /** Projected points still to come; null when no starter with games left has a projection. */
  remainingProjection: number | null
  /** True when some starter with games left had no projection, so the remainder is understated. */
  partial: boolean
}

export function teamOutlook(starters: readonly StarterGames[]): TeamOutlook {
  let playersLeft = 0
  let gamesLeft = 0
  let remaining = 0
  let projected = 0
  let missing = 0
  for (const s of starters) {
    const left = Math.max(0, Math.min(s.gamesLeft, s.gamesThisWeek))
    if (left <= 0) continue
    playersLeft += 1
    gamesLeft += left
    if (s.weekProjection == null || !Number.isFinite(s.weekProjection) || s.gamesThisWeek <= 0) {
      missing += 1
      continue
    }
    remaining += (s.weekProjection * left) / s.gamesThisWeek
    projected += 1
  }
  return {
    playersLeft,
    starters: starters.length,
    gamesLeft,
    remainingProjection: playersLeft === 0 ? 0 : projected > 0 ? Math.round(remaining * 10) / 10 : null,
    partial: missing > 0 && projected > 0,
  }
}

/**
 * Pure: one starter across the weeks of a period, as the single-week shape `teamOutlook` reads — games and games
 * left added up, and the projection for the whole period. A week whose projection is not out yet (the second week
 * of a two-week period, while the first is played) borrows the player's projection from another week of the
 * period, scaled by games; with none anywhere the projection stays unknown.
 */
export function periodStarterGames(weeks: ReadonlyArray<{ projection: number | null; games: number; left: number }>): StarterGames {
  const known = weeks.find((w) => w.projection != null && Number.isFinite(w.projection) && w.games > 0)
  let projection: number | null = null
  let games = 0
  let left = 0
  for (const w of weeks) {
    games += w.games
    left += w.left
    if (w.games <= 0) continue
    const p = w.projection != null && Number.isFinite(w.projection) ? w.projection : known ? (known.projection! * w.games) / known.games : null
    if (p != null) projection = (projection ?? 0) + p
  }
  return { weekProjection: projection, gamesThisWeek: games, gamesLeft: left }
}

/** Remaining points spread as a share of what is projected (a fantasy week's usual swing, about ±40%). */
export const SPREAD = 0.4
export const SIMS = 4000

/** mulberry32: small, fast and seedable, so the same week always prints the same odds. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function normal(next: () => number): number {
  const u = Math.max(next(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next())
}

function seedOf(ids: readonly string[]): number {
  let h = 2166136261
  for (const ch of ids.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}

/**
 * Each team's chance of NOT being chopped, 0–100 (whole numbers). Null when any team alive has no
 * projection for games it still has to play — odds built on a guess for one team would be wrong for all.
 */
export function survivalOdds(
  teams: ReadonlyArray<{ rosterId: string; current: number; remainingProjection: number | null; immune?: boolean }>,
  chopCount: number,
  opts: { sims?: number; spread?: number } = {},
): Map<string, number> | null {
  if (teams.length === 0) return null
  if (teams.some((t) => t.remainingProjection == null)) return null
  const out = new Map<string, number>()
  const choppable = teams.filter((t) => !t.immune)
  const chops = Math.max(0, Math.min(chopCount, choppable.length - 1))
  for (const t of teams) out.set(t.rosterId, 100)
  if (chops === 0) return out
  const sims = opts.sims ?? SIMS
  const spread = opts.spread ?? SPREAD
  const next = rng(seedOf(teams.map((t) => `${t.rosterId}:${t.current}:${t.remainingProjection}`)))
  const survived = new Map<string, number>(choppable.map((t) => [t.rosterId, 0]))
  const finals = new Array<{ id: string; v: number }>(choppable.length)
  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < choppable.length; i++) {
      const t = choppable[i]!
      const rem = t.remainingProjection as number
      const v = t.current + Math.max(0, rem + (rem > 0 ? normal(next) * spread * rem : 0))
      finals[i] = { id: t.rosterId, v }
    }
    finals.sort((a, b) => a.v - b.v)
    for (let i = chops; i < finals.length; i++) survived.set(finals[i]!.id, survived.get(finals[i]!.id)! + 1)
  }
  for (const [id, n] of survived) {
    const pct = (n / sims) * 100
    // Never print a certainty the simulation cannot promise while points are still to be scored.
    const anyLeft = teams.some((t) => (t.remainingProjection ?? 0) > 0)
    out.set(id, anyLeft ? Math.min(99, Math.max(1, Math.round(pct))) : Math.round(pct))
  }
  return out
}
