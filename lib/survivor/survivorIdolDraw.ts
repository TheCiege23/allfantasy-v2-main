import {
  SURVIVOR_IDOL_COUNT_OPTIONS,
  SURVIVOR_IDOL_PICK_COUNT_MAX,
  SURVIVOR_IDOL_PICK_COUNT_MIN,
  isSurvivorIdolTypePlayable,
  type SurvivorIdolTypeDef,
} from './survivorIdolTypes'

/**
 * Which idol types a Survivor league hides (survivor-theme handoff, "Selection system").
 *
 * Only PLAYABLE types are ever drawn, picked or seeded: a type is playable when the play-engine
 * registry (survivorIdolEngines.ts) names it. "Always in" applies to always-in types that are
 * playable; the others join automatically once their engine is registered.
 *
 * Pure and client-safe. The caller supplies the random source: the server passes a secure RNG
 * (`node:crypto` randomInt) at draft lock; the commissioner preview may pass anything.
 *
 * Balanced draw, applied to the random picks only (the always-in idols are not "picks"):
 *  - at most one tier-3 idol
 *  - at most two from the same group
 *  - at least one Votes idol, and at least one Scoring or Roster idol
 * Among distinct sets the draw is uniform over the sets that break the fewest rules (zero when a
 * fully balanced set exists). When there are fewer playable types than slots, every playable type
 * is used once and the remaining slots repeat them, never repeating a tier-3 idol while a lighter
 * one is available and spreading the repeats evenly. The draw never fails for 6, 7 or 8 while at
 * least one type is playable.
 */

/** Returns an integer in [0, maxExclusive). */
export type SurvivorRandomInt = (maxExclusive: number) => number

export type SurvivorIdolDrawMode = 'random' | 'pick'

export const SURVIVOR_IDOL_DRAW_RULES = { maxTier3: 1, maxPerCategory: 2 } as const

type DrawType = Pick<SurvivorIdolTypeDef, 'id' | 'category' | 'tier' | 'alwaysIn' | 'sortOrder' | 'enginePowerType'>

export type SurvivorIdolDrawResult =
  | { ok: true; typeIds: string[] }
  | { ok: false; code: 'invalid_count' | 'invalid_pick' | 'infeasible'; error: string }

export function isSurvivorIdolCount(value: unknown): value is (typeof SURVIVOR_IDOL_COUNT_OPTIONS)[number] {
  return typeof value === 'number' && (SURVIVOR_IDOL_COUNT_OPTIONS as readonly number[]).includes(value)
}

/** The draw pool: playable types split into the always-in ones and the rest. */
export function playableIdolPool<T extends DrawType>(types: readonly T[]): { always: T[]; extras: T[] } {
  const playable = types.filter(isSurvivorIdolTypePlayable)
  return { always: playable.filter(type => type.alwaysIn), extras: playable.filter(type => !type.alwaysIn) }
}

/** Violations of the balanced-draw rules for a set of random picks (empty = balanced). */
export function balancedDrawViolations(picks: readonly Pick<DrawType, 'category' | 'tier'>[]): string[] {
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

function shuffle<T>(values: readonly T[], randomInt: SurvivorRandomInt): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/** Fill `slots` from `base` by repeating it: lighter idols first, fewest copies first. */
function fillWithRepeats<T extends DrawType>(base: readonly T[], slots: number, randomInt: SurvivorRandomInt): T[] {
  const result = [...base]
  const copies = new Map(base.map(type => [type.id, 1]))
  while (result.length < slots) {
    const candidates = shuffle(base, randomInt)
    const lighter = candidates.filter(type => type.tier < 3)
    const pool = lighter.length ? lighter : candidates
    const fewest = Math.min(...pool.map(type => copies.get(type.id) ?? 0))
    const next = pool.find(type => (copies.get(type.id) ?? 0) === fewest)!
    result.push(next)
    copies.set(next.id, (copies.get(next.id) ?? 0) + 1)
  }
  return result
}

const ENUMERATION_LIMIT = 250_000
const REJECTION_ATTEMPTS = 20_000

/** Distinct random picks: uniform over the sets that break the fewest balance rules. */
function drawDistinct<T extends DrawType>(pool: readonly T[], slots: number, randomInt: SurvivorRandomInt): T[] {
  if (binomial(pool.length, slots) <= ENUMERATION_LIMIT) {
    let best: T[][] = []
    let bestScore = Infinity
    combinations(pool, slots, combo => {
      const score = balancedDrawViolations(combo).length
      if (score < bestScore) { bestScore = score; best = [combo] } else if (score === bestScore) best.push(combo)
    })
    return best[randomInt(best.length)]
  }
  let fallback: T[] = pool.slice(0, slots)
  let fallbackScore = Infinity
  for (let attempt = 0; attempt < REJECTION_ATTEMPTS; attempt++) {
    const picks = shuffle(pool, randomInt).slice(0, slots)
    const score = balancedDrawViolations(picks).length
    if (score === 0) return picks
    if (score < fallbackScore) { fallbackScore = score; fallback = picks }
  }
  return fallback
}

/**
 * The balanced draw. Every playable always-in type is included; the remaining `count - always`
 * slots come from the other playable types (with repeats when there are too few of them).
 */
export function drawBalancedIdolTypes(types: readonly DrawType[], count: number, randomInt: SurvivorRandomInt): SurvivorIdolDrawResult {
  if (!isSurvivorIdolCount(count)) return { ok: false, code: 'invalid_count', error: 'Choose 6, 7 or 8 idols.' }
  const { always, extras } = playableIdolPool(types)
  if (!always.length && !extras.length) return { ok: false, code: 'infeasible', error: 'No idol types can be played yet.' }
  const fixed = always.slice(0, count)
  const slots = count - fixed.length
  if (slots === 0) return { ok: true, typeIds: ordered(fixed) }
  // Nothing else is playable: repeat the always-in idols.
  if (!extras.length) return { ok: true, typeIds: ordered([...fixed, ...fillWithRepeats(fixed, fixed.length + slots, randomInt).slice(fixed.length)]) }
  const picks = extras.length >= slots
    ? drawDistinct(extras, slots, randomInt)
    : fillWithRepeats(shuffle(extras, randomInt), slots, randomInt)
  return { ok: true, typeIds: ordered([...fixed, ...picks]) }
}

/**
 * Pick mode (owner's call, 2026-10-20): the commissioner chooses a QUANTITY per playable type.
 * `picked` is the full multiset — one entry per copy — of 1 to 12 ids, and it must carry every
 * playable always-in type at least once. The count is the list's length.
 */
export function pickBounds(types: readonly DrawType[]): { min: number; max: number; alwaysIds: string[] } {
  const { always } = playableIdolPool(types)
  return { min: Math.max(SURVIVOR_IDOL_PICK_COUNT_MIN, always.length), max: SURVIVOR_IDOL_PICK_COUNT_MAX, alwaysIds: always.map(type => type.id) }
}

/** How many copies of each id a pick list carries. */
export function pickQuantities(picked: readonly string[]): Map<string, number> {
  const quantities = new Map<string, number>()
  for (const id of picked) quantities.set(id, (quantities.get(id) ?? 0) + 1)
  return quantities
}

/** Rebuild a pick list with `quantity` copies of `id`, keeping every other id's copies. */
export function withPickQuantity(picked: readonly string[], id: string, quantity: number): string[] {
  const copies = Math.max(0, Math.min(SURVIVOR_IDOL_PICK_COUNT_MAX, Math.round(quantity)))
  return [...picked.filter(entry => entry !== id), ...Array.from({ length: copies }, () => id)]
}

export function validatePickedIdolTypes(types: readonly DrawType[], count: number, picked: readonly string[]): SurvivorIdolDrawResult {
  if (!Number.isInteger(count) || count < SURVIVOR_IDOL_PICK_COUNT_MIN || count > SURVIVOR_IDOL_PICK_COUNT_MAX) {
    return { ok: false, code: 'invalid_count', error: `Pick ${SURVIVOR_IDOL_PICK_COUNT_MIN} to ${SURVIVOR_IDOL_PICK_COUNT_MAX} idols.` }
  }
  if (picked.length !== count) return { ok: false, code: 'invalid_pick', error: `Pick ${count} idols in total.` }
  const byId = new Map(types.map(type => [type.id, type]))
  const unique = [...new Set(picked)]
  if (unique.some(id => !byId.has(id))) return { ok: false, code: 'invalid_pick', error: 'Pick from the listed idol types.' }
  if (unique.some(id => !isSurvivorIdolTypePlayable(byId.get(id)!))) return { ok: false, code: 'invalid_pick', error: 'That idol is coming soon and cannot be hidden in a league yet.' }
  const { alwaysIds } = pickBounds(types)
  const missing = alwaysIds.filter(id => !unique.includes(id))
  if (missing.length) return { ok: false, code: 'invalid_pick', error: `${missing.map(id => byId.get(id)!.id).join(', ')} is in every league: keep at least one.` }
  // Always-in copies first, then the rest by catalogue order; copies stay together.
  const sorted = [...picked].map(id => byId.get(id)!).sort((a, b) => Number(b.alwaysIn) - Number(a.alwaysIn) || a.sortOrder - b.sortOrder)
  return { ok: true, typeIds: sorted.map(type => type.id) }
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
