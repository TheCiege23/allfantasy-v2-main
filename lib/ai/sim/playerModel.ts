import type { SimPlayerInput } from '@/lib/ai/sim/types'

/** Mulberry32 PRNG */
export function createRng(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

export function effectiveVariance(p: SimPlayerInput): number {
  const base = Math.max(0.5, p.variance ?? 6)
  const cons = p.consistency ?? 0.5
  const inj = p.injuryRisk ?? 0
  const v = base * (1.4 - cons * 0.6) * (1 + inj * 0.35)
  return Math.max(0.25, v)
}

export function effectiveProjection(p: SimPlayerInput): number {
  const t = p.usageTrend ?? 0
  return p.projection * (1 + t * 0.08)
}

/**
 * Single simulated weekly score for a player (projection + noise).
 */
export function sampleWeeklyScore(player: SimPlayerInput, rng: () => number): number {
  return sampleNormalScore(effectiveProjection(player), effectiveVariance(player), rng)
}

/** One Box-Muller draw around `mu`, floored at zero. Consumes exactly two `rng()` values. */
function sampleNormalScore(mu: number, sigma: number, rng: () => number): number {
  const u1 = Math.max(1e-9, rng())
  const u2 = rng()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return Math.max(0, mu + sigma * z)
}

/**
 * `sampleTeamWeeklyScore` with the roster work done once instead of on every draw.
 *
 * ⚠ THE SORT WAS THE COST, NOT THE RANDOM NUMBERS. A season Monte Carlo samples every team every
 * week of every iteration, and each sample copied and re-sorted a roster that never changes inside
 * the run — measured 2026-09-25 as most of the 21 s `/trades/rosters` took on a 32-team league.
 *
 * ⚠ BIT-IDENTICAL TO `sampleTeamWeeklyScore`, WHICH IS WHAT MAKES THIS SAFE TO SWAP IN. Same stable
 * sort, same starters in the same order, the same `mu`/`sigma` doubles, and the same two `rng()`
 * draws per starter — so a seeded simulation returns exactly the numbers it returned before.
 */
export function prepareTeamWeeklySampler(players: SimPlayerInput[], starterSlots = 9): (rng: () => number) => number {
  if (!players.length) return () => 0
  const sorted = [...players].sort((a, b) => effectiveProjection(b) - effectiveProjection(a))
  const starters = sorted.slice(0, Math.min(starterSlots, sorted.length))
  const mus = starters.map(effectiveProjection)
  const sigmas = starters.map(effectiveVariance)
  return (rng) => {
    let total = 0
    for (let i = 0; i < mus.length; i += 1) total += sampleNormalScore(mus[i]!, sigmas[i]!, rng)
    return total
  }
}

/** Sum starter scores — cap roster to top-N by projection to mimic starters (simplified). */
export function sampleTeamWeeklyScore(players: SimPlayerInput[], rng: () => number, starterSlots = 9): number {
  if (!players.length) return 0
  const sorted = [...players].sort((a, b) => effectiveProjection(b) - effectiveProjection(a))
  const starters = sorted.slice(0, Math.min(starterSlots, sorted.length))
  let total = 0
  for (const pl of starters) {
    total += sampleWeeklyScore(pl, rng)
  }
  return total
}

export function rosterStrengthIndex(players: SimPlayerInput[]): number {
  if (!players.length) return 0
  const sorted = [...players].sort((a, b) => effectiveProjection(b) - effectiveProjection(a))
  const top = sorted.slice(0, 9)
  return top.reduce((s, p) => s + effectiveProjection(p), 0)
}

/** 0–100 balance: lower std of positional counts of top starters */
export function positionalBalanceScore(players: SimPlayerInput[]): number {
  const byPos: Record<string, number> = {}
  const sorted = [...players].sort((a, b) => effectiveProjection(b) - effectiveProjection(a)).slice(0, 9)
  for (const p of sorted) {
    const k = p.position?.slice(0, 2) ?? 'UNK'
    byPos[k] = (byPos[k] ?? 0) + 1
  }
  const vals = Object.values(byPos)
  const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length)
  const varc = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, vals.length)
  return Math.max(0, 100 - varc * 12)
}
