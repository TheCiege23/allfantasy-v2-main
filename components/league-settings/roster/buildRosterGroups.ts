/**
 * Pure, sport-driven roster layout for the commissioner roster editor.
 *
 * ⚠ EVERYTHING HERE IS DERIVED FROM THE SPORT'S OWN `slotDefs` (served by the roster API for the
 * league's sport). Nothing injects or orders football slots unless the sport IS football — an NBA
 * league must show PG/SG/SF/PF/C/G/F/UTIL/BN/IL and never QB/RB/WR.
 */
import type { SlotDef } from './types'

export type RosterGroupKind =
  | 'offense' | 'flex' | 'kicker' | 'dst' | 'idp' | 'bench' | 'injured' | 'reserve' | 'college' | 'other'

export interface RosterGroup {
  kind: RosterGroupKind
  /** For `injured`: the sport's own injured-list code (IR for football/NHL, IL for NBA/MLB…). */
  injuredCode?: string
  defs: SlotDef[]
}

export const FOOTBALL_SPORTS = new Set(['NFL', 'NCAAF'])

export function isFootballSport(sport: unknown): boolean {
  return FOOTBALL_SPORTS.has(String(sport ?? '').trim().toUpperCase())
}

/** IR / IL style injured slots (incl. IR+ / IL+). Listed apart: they don't use draft rounds. */
export function isInjuredSlot(def: Pick<SlotDef, 'key'>): boolean {
  return /^(IR|IL)(_?PLUS|\+)?$/i.test(def.key)
}

const GROUP_ORDER: RosterGroupKind[] = ['offense', 'flex', 'kicker', 'dst', 'idp', 'bench', 'injured', 'reserve', 'college', 'other']
const KNOWN_CATEGORIES = new Set(['offense', 'flex', 'kicker', 'dst', 'idp', 'bench', 'reserve', 'college'])

/**
 * Re-key a stored slot map onto the sport's slot definitions.
 *
 * Returns only keys the sport defines. `foreign` is true when the stored map is mostly keys the
 * sport does not have — e.g. an NFL roster saved onto an NBA league — so the editor can say so
 * instead of silently rendering an empty or wrong roster.
 */
export function alignSlotsToSport(
  raw: Record<string, number> | null | undefined,
  defs: SlotDef[],
): { slots: Record<string, number>; foreign: boolean } {
  const src: Record<string, number> = { ...(raw ?? {}) }
  if (defs.length === 0) return { slots: src, foreign: false }
  const known = new Set(defs.map((d) => d.key))
  // Legacy aliases, only where the sport actually defines the canonical key.
  if (known.has('SUPERFLEX') && !known.has('SF') && src.SUPERFLEX == null && src.SF != null) src.SUPERFLEX = Number(src.SF || 0)
  if (known.has('DEF') && !known.has('DST') && src.DEF == null && src.DST != null) src.DEF = Number(src.DST || 0)

  const positive = Object.keys(src).filter((k) => Number(src[k]) > 0)
  const matching = positive.filter((k) => known.has(k))
  const unknown = positive.filter((k) => !known.has(k))
  const foreign = unknown.length > 0 && unknown.length > matching.length

  const slots: Record<string, number> = {}
  for (const def of defs) {
    if (src[def.key] == null) continue
    const n = Number(src[def.key])
    if (Number.isFinite(n)) slots[def.key] = n
  }
  return { slots, foreign }
}

/**
 * Group the sport's slot definitions for display.
 * - commissioners see every standard slot (so a 0-count slot can be turned on), but IDP slots only
 *   for football and college (C2C) slots only when the league already uses them;
 * - members see only slots the league actually uses.
 */
export function buildRosterGroups(
  defs: SlotDef[],
  slots: Record<string, number>,
  opts: { isCommissioner: boolean; sport?: string | null },
): RosterGroup[] {
  const football = isFootballSport(opts.sport)
  const usesCollege = defs.some((d) => d.category === 'college' && (slots[d.key] ?? 0) > 0)
  const buckets = new Map<RosterGroupKind, SlotDef[]>()
  for (const def of defs) {
    const count = slots[def.key] ?? 0
    let kind: RosterGroupKind = KNOWN_CATEGORIES.has(def.category) ? (def.category as RosterGroupKind) : 'other'
    if (kind === 'reserve' && isInjuredSlot(def)) kind = 'injured'
    if (count <= 0) {
      if (!opts.isCommissioner) continue
      if (kind === 'college' && !usesCollege) continue
      if (kind === 'idp' && !football) continue
    }
    const list = buckets.get(kind) ?? []
    list.push(def)
    buckets.set(kind, list)
  }
  const groups: RosterGroup[] = []
  for (const kind of GROUP_ORDER) {
    const list = buckets.get(kind)
    if (!list || list.length === 0) continue
    const group: RosterGroup = { kind, defs: list }
    if (kind === 'injured') group.injuredCode = list.some((d) => /^IR/i.test(d.key)) ? 'IR' : 'IL'
    groups.push(group)
  }
  return groups
}
