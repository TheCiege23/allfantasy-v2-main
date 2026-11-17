/**
 * Seeded randomness for the season sim. The generator is the repo's existing mulberry32
 * (`lib/core-app/outlookSim.ts`, pure and client-safe) rather than a second copy of it.
 *
 * Every random decision in a run descends from ONE seed, so a failing run is reproduced by its seed
 * alone. Never call `Math.random()` anywhere under `lib/season-sim/`.
 */
import { createRng, gaussian, seedFromString } from '@/lib/core-app/outlookSim'

export type SimRng = {
  /** [0, 1). */
  next(): number
  int(minInclusive: number, maxInclusive: number): number
  chance(probability: number): boolean
  pick<T>(values: readonly T[]): T
  shuffle<T>(values: readonly T[]): T[]
  normal(mu: number, sigma: number): number
  /** An independent stream, so adding draws in one subsystem does not shift every other one. */
  fork(label: string): SimRng
}

export function normalizeSeed(seed: number | string): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0 || 1
  return seedFromString(String(seed))
}

export function createSimRng(seed: number | string): SimRng {
  const base = normalizeSeed(seed)
  const next = createRng(base)
  const rng: SimRng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (values) => {
      if (!values.length) throw new Error('SimRng.pick on an empty list')
      return values[Math.floor(next() * values.length)]!
    },
    shuffle: (values) => {
      const out = [...values]
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1))
        ;[out[i], out[j]] = [out[j]!, out[i]!]
      }
      return out
    },
    normal: (mu, sigma) => gaussian(next, mu, sigma),
    fork: (label) => createSimRng(seedFromString(`${base}:${label}`)),
  }
  return rng
}
