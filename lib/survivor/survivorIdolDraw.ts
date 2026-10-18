import {
  SURVIVOR_IDOL_COUNT_OPTIONS,
  type SurvivorIdolTypeDef,
} from './survivorIdolTypes'

/**
 * Which idol types a Survivor league hides (survivor-theme handoff, "Selection system").
 *
 * Pure and client-safe. The caller supplies the random source: the server passes a secure RNG
 * (`node:crypto` randomInt) at draft lock; the commissioner preview may pass anything.
 *
 * Balanced draw, applied to the random picks only (the always-in idols are not "picks"):
 *  - at most one tier-3 idol
 *  - at most two from the same group
 *  - at least one Votes idol, and at least one Scoring or Roster idol
 */

/** Returns an integer in [0, maxExclusive). */
export type SurvivorRandomInt = (maxExclusive: number) => number

export type SurvivorIdolDrawMode = 'random' | 'pick'

export const SURVIVOR_IDOL_DRAW_RULES = { maxTier3: 1, maxPerCategory: 2 } as const

type DrawType = Pick<SurvivorIdolTypeDef, 'id' | 'category' | 'tier' | 'alwaysIn' | 'sortOrder'>

export type SurvivorIdolDrawResult =
  | { ok: true; typeIds: string[] }
  | { ok: false; code: 'invalid_count' | 'invalid_pick' | 'infeasible'; error: string }

export function isSurvivorIdolCount(value: unknown): value is (typeof SURVIVOR_IDOL_COUNT_OPTIONS)[number] {
  return typeof value === 'number' && (SURVIVOR_IDOL_COUNT_OPTIONS as readonly number[]).includes(value)
}

/** Violations of the balanced-draw rules for a set of random picks (empty = balanced). */
export function balancedDrawViolations(picks: readonly DrawType[]): string[] {
  const violations: string[] = []
  if (picks.filter(type => type.tier >= 3).length > SURVIVOR_IDOL_DRAW_RULES.maxTier3) violations.push('more than one tier-3 idol')
  const perCategory = new Map<string, number>()
  for (const type of picks) perCategory.set(type.category, (perCategory.get(type.category) ?? 0) + 1)
  for (const [category, count] of perCategory) {
    if (count > SURVIVOR_IDOL_DRAW_RULES.maxPerCategory) violations.push(`more than two ${category} idols`)
  }
  if (!picks.some(type => type.category === 'Votes')) violations.push('no Votes idol')
  if (!picks.some(type => type.category === 'Scoring' || type.category === 'Roster')) violations.push('no Scoring or Roster idol')
  return violations
}

function ordered(types: readonly DrawType[]): string[] {
  return [...types].sort((a, b) => Number(b.alwaysIn) - Number(a.alwaysIn) || a.sortOrder - b.sortOrder).map(type => type.id)
}

function combinations<T>(items: readonly T[], size: number, visit: (combo: T[]) => void) {
  const combo: T[] = []
  const walk = (start: number) => {
    if (combo.length === size) { visit([...combo]); return }
    for (let index = start; index <= items.length - (size - combo.length); index++) {
      combo.push(items[index])
      walk(index + 1)
      combo.pop()
    }
  }
  walk(0)
}

function binomial(n: number, k: number): number {
  let result = 1
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i
  return result
}

const ENUMERATION_LIMIT = 250_000
const REJECTION_ATTEMPTS = 20_000

/**
 * The balanced draw. Every always-in type is included; the remaining `count - alwaysIn` slots are
 * chosen uniformly at random among the balanced sets (enumerated exactly while the pool is small,
 * rejection-sampled beyond that).
 */
export function drawBalancedIdolTypes(types: readonly DrawType[], count: number, randomInt: SurvivorRandomInt): SurvivorIdolDrawResult {
  if (!isSurvivorIdolCount(count)) return { ok: false, code: 'invalid_count', error: 'Choose 6, 7 or 8 idols.' }
  const always = types.filter(type => type.alwaysIn)
  const pool = types.filter(type => !type.alwaysIn)
  const slots = count - always.length
  if (slots < 0 || slots > pool.length) return { ok: false, code: 'infeasible', error: 'There are not enough idol types for this count.' }
  if (slots === 0) return { ok: true, typeIds: ordered(always) }

  if (binomial(pool.length, slots) <= ENUMERATION_LIMIT) {
    const valid: DrawType[][] = []
    combinations(pool, slots, combo => { if (balancedDrawViolations(combo).length === 0) valid.push(combo) })
    if (!valid.length) return { ok: false, code: 'infeasible', error: 'No balanced draw exists for these idol types.' }
    return { ok: true, typeIds: ordered([...always, ...valid[randomInt(valid.length)]]) }
  }

  for (let attempt = 0; attempt < REJECTION_ATTEMPTS; attempt++) {
    const shuffled = [...pool]
    for (let i = shuffled.length - 1; i > shuffled.length - 1 - slots; i--) {
      const j = randomInt(i + 1)
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    const picks = shuffled.slice(shuffled.length - slots)
    if (balancedDrawViolations(picks).length === 0) return { ok: true, typeIds: ordered([...always, ...picks]) }
  }
  return { ok: false, code: 'infeasible', error: 'No balanced draw was found for these idol types.' }
}

/** Pick mode: the commissioner chooses exactly `count - alwaysIn` of the other types. */
export function validatePickedIdolTypes(types: readonly DrawType[], count: number, picked: readonly string[]): SurvivorIdolDrawResult {
  if (!isSurvivorIdolCount(count)) return { ok: false, code: 'invalid_count', error: 'Choose 6, 7 or 8 idols.' }
  const always = types.filter(type => type.alwaysIn)
  const byId = new Map(types.map(type => [type.id, type]))
  const need = count - always.length
  const unique = [...new Set(picked)]
  if (unique.length !== picked.length) return { ok: false, code: 'invalid_pick', error: 'Each idol type can be picked once.' }
  if (unique.some(id => !byId.has(id))) return { ok: false, code: 'invalid_pick', error: 'Pick from the listed idol types.' }
  if (unique.some(id => byId.get(id)!.alwaysIn)) return { ok: false, code: 'invalid_pick', error: 'Immunity and Tribe immunity are already in every league.' }
  if (unique.length !== need) return { ok: false, code: 'invalid_pick', error: `Pick exactly ${need} idol types.` }
  return { ok: true, typeIds: ordered([...always, ...unique.map(id => byId.get(id)!)]) }
}

/** The league's idol types for a saved config: a balanced draw, or the commissioner's picks. */
export function resolveSurvivorIdolTypeIds(
  types: readonly DrawType[],
  config: { mode: SurvivorIdolDrawMode; count: number; pickedTypeIds: readonly string[] },
  randomInt: SurvivorRandomInt,
): SurvivorIdolDrawResult {
  return config.mode === 'pick'
    ? validatePickedIdolTypes(types, config.count, config.pickedTypeIds)
    : drawBalancedIdolTypes(types, config.count, randomInt)
}

/** A browser-side random source for the commissioner's preview draw (never the real draw). */
export function browserRandomInt(maxExclusive: number): number {
  if (maxExclusive <= 1) return 0
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (cryptoApi?.getRandomValues) {
    const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive
    const buffer = new Uint32Array(1)
    do { cryptoApi.getRandomValues(buffer) } while (buffer[0] >= limit)
    return buffer[0] % maxExclusive
  }
  return Math.floor(Math.random() * maxExclusive)
}
