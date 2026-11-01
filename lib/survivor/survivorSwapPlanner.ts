/**
 * Plans a tribe swap of any kind — pure, no DB. The server seals the plan and applies it at the
 * reveal (lib/survivor/tribeSwapService.ts), exactly like the original random swap.
 *
 * A plan names tribes by id. A tribe the swap ADDS has no row yet, so it is named `new:<n>` and the
 * reveal creates it; the draw stays sealed until then, so nobody sees an empty extra tribe appear
 * early. A tribe the swap FOLDS is listed in `retire`; the reveal deactivates it. A swap back to the
 * original tribes reactivates whichever of them were folded.
 */

import type { TribeSnapshot } from './tribeSwapReveal'
import type { SurvivorScheduledSwap, SurvivorSwapOrder } from './survivorGovernanceSettings'

export const NEW_TRIBE_PREFIX = 'new:'

export function isNewTribeKey(tribeId: string): boolean {
  return tribeId.startsWith(NEW_TRIBE_PREFIX)
}

export interface SwapPlanInput {
  /** The active tribes now, in slot order, each with its ACTIVE rosters only. */
  before: ReadonlyArray<TribeSnapshot>
  swap: Pick<SurvivorScheduledSwap, 'mode' | 'tribeCount' | 'pattern' | 'order'>
  /** The tribes as they were first formed (oldest swap's "before"), for `return_to_original`. */
  original?: ReadonlyArray<TribeSnapshot> | null
  /** Season points per roster, for a pattern dealt in `season_points` order. */
  seasonPoints?: ReadonlyMap<string, number>
  /** Uniform integer in [0, exclusiveMax). The server passes a crypto RNG. */
  randomIndex: (exclusiveMax: number) => number
}

export type SwapPlan =
  | { ok: true; after: TribeSnapshot[]; retire: string[]; created: number }
  | { ok: false; error: string }

function shuffle<T>(items: T[], randomIndex: (n: number) => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** Tribe ids for a target count: keep the first N existing tribes, add `new:` keys past them. */
function targetTribeIds(before: ReadonlyArray<TribeSnapshot>, count: number): string[] {
  const ids = before.slice(0, count).map((t) => t.tribeId)
  for (let n = 1; ids.length < count; n++) ids.push(`${NEW_TRIBE_PREFIX}${n}`)
  return ids
}

/** Deal round-robin over the order so sizes stay within one. */
function deal(order: string[], tribeIds: string[]): TribeSnapshot[] {
  return tribeIds.map((tribeId, slot) => ({ tribeId, rosterIds: order.filter((_, i) => i % tribeIds.length === slot) }))
}

/** Pattern letter → slot: A = 0 … E = 4. */
export function patternSlots(pattern: string): number[] {
  return [...pattern.toUpperCase()].map((ch) => ch.charCodeAt(0) - 65).filter((n) => n >= 0 && n <= 4)
}

/** The pattern's tribe count: the highest letter used (a pattern "AC" still needs a B tribe). */
export function patternTribeCount(pattern: string): number {
  const slots = patternSlots(pattern)
  return slots.length ? Math.max(...slots) + 1 : 0
}

function orderedCast(all: string[], order: SurvivorSwapOrder | undefined, points: ReadonlyMap<string, number> | undefined, randomIndex: (n: number) => number): string[] {
  if (order === 'random') return shuffle(all, randomIndex)
  // Season points, best first; ties keep a stable id order so the plan is reproducible.
  return [...all].sort((a, b) => (points?.get(b) ?? 0) - (points?.get(a) ?? 0) || a.localeCompare(b))
}

export function planTribeSwap(input: SwapPlanInput): SwapPlan {
  const before = input.before.filter((t) => t.tribeId)
  const all = before.flatMap((t) => t.rosterIds)
  if (before.length < 1 || all.length < 4) return { ok: false, error: 'A swap needs at least four managers still in the game.' }
  const beforeIds = before.map((t) => t.tribeId)
  const finish = (after: TribeSnapshot[]): SwapPlan => {
    if (after.some((t) => t.rosterIds.length === 0)) return { ok: false, error: 'That swap would leave a tribe with nobody in it.' }
    if (after.length < 2) return { ok: false, error: 'A swap must leave at least two tribes.' }
    const kept = new Set(after.map((t) => t.tribeId))
    return { ok: true, after, retire: beforeIds.filter((id) => !kept.has(id)), created: after.filter((t) => isNewTribeKey(t.tribeId)).length }
  }

  switch (input.swap.mode) {
    case 'random_shuffle':
      if (before.length < 2) return { ok: false, error: 'A swap needs at least two active tribes.' }
      return finish(deal(shuffle(all, input.randomIndex), beforeIds))
    case 'resize': {
      const count = input.swap.tribeCount ?? before.length
      if (!Number.isInteger(count) || count < 2 || count > 5) return { ok: false, error: 'Choose 2 to 5 tribes.' }
      if (all.length < count * 2) return { ok: false, error: `${all.length} managers cannot fill ${count} tribes of two or more.` }
      return finish(deal(shuffle(all, input.randomIndex), targetTribeIds(before, count)))
    }
    case 'custom_pattern': {
      const slots = patternSlots(input.swap.pattern ?? '')
      const count = patternTribeCount(input.swap.pattern ?? '')
      if (slots.length < 2 || count < 2) return { ok: false, error: 'The pattern needs letters A to E naming at least two tribes.' }
      const ids = targetTribeIds(before, count)
      const groups = ids.map((tribeId) => ({ tribeId, rosterIds: [] as string[] }))
      orderedCast(all, input.swap.order, input.seasonPoints, input.randomIndex).forEach((rosterId, i) => {
        groups[slots[i % slots.length]!]!.rosterIds.push(rosterId)
      })
      return finish(groups)
    }
    case 'return_to_original': {
      const original = (input.original ?? []).filter((t) => t.tribeId)
      if (original.length < 2) return { ok: false, error: 'There is no record of the original tribes to return to.' }
      const home = new Map<string, string>()
      for (const tribe of original) for (const id of tribe.rosterIds) home.set(id, tribe.tribeId)
      const groups = original.map((t) => ({ tribeId: t.tribeId, rosterIds: [] as string[] }))
      const newcomers: string[] = []
      for (const id of all) {
        const tribeId = home.get(id)
        const group = tribeId ? groups.find((g) => g.tribeId === tribeId) : undefined
        if (group) group.rosterIds.push(id)
        else newcomers.push(id)
      }
      // Anyone who joined after the first tribes were drawn goes to the smallest original tribe.
      for (const id of newcomers) {
        const smallest = [...groups].sort((a, b) => a.rosterIds.length - b.rosterIds.length || a.tribeId.localeCompare(b.tribeId))[0]!
        smallest.rosterIds.push(id)
      }
      // An original tribe with nobody left stays retired rather than coming back empty.
      return finish(groups.filter((g) => g.rosterIds.length > 0))
    }
    default:
      return { ok: false, error: 'Unknown swap type.' }
  }
}
