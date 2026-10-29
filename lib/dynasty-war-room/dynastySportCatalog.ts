/**
 * DYNASTY WAR ROOM — per-sport slot catalog helpers (pure, deterministic, no I/O).
 *
 * The War Room was written against NFL slots: every FLEX/UTIL starter became RB/WR/TE demand,
 * the free-agent pool kept only NFL/IDP positions, and the ADP→value scale zeroed every pick
 * past 260. For MLB, NBA and NHL that invented RB/WR/TE needs and emptied the pool.
 *
 * Everything here reads the sport's OWN slot catalog (`lib/{nfl,nba,mlb,nhl}-roster/*RosterTemplates.ts`,
 * the same `*_SLOT_MAP`s `RosterTemplateService` resolves commissioner configs with), so a slot's
 * eligible positions are defined in exactly one place.
 *
 * 🛑 NFL IS DELIBERATELY UNTOUCHED. For NFL (and any sport without a catalog here) callers keep the
 * legacy behaviour byte-for-byte; these helpers return `null` so the caller's NFL path runs.
 */
import { NFL_ROSTER_TEMPLATES, type RosterSlotDef } from '@/lib/nfl-roster/NflRosterTemplates'
import { NBA_ROSTER_TEMPLATES, NBA_SLOT_MAP } from '@/lib/nba-roster/NbaRosterTemplates'
import { MLB_ROSTER_TEMPLATES, MLB_SLOT_MAP } from '@/lib/mlb-roster/MlbRosterTemplates'
import { NHL_ROSTER_TEMPLATES, NHL_SLOT_MAP } from '@/lib/nhl-roster/NhlRosterTemplates'

export type CatalogSport = 'NBA' | 'MLB' | 'NHL'

/** Upper-cased sport when it is one of the non-NFL sports this module models, else null. */
export function catalogSport(sport: string | null | undefined): CatalogSport | null {
  const s = String(sport ?? '').trim().toUpperCase()
  return s === 'NBA' || s === 'MLB' || s === 'NHL' ? s : null
}

function slotMapFor(sport: CatalogSport): Map<string, RosterSlotDef> {
  if (sport === 'NBA') return NBA_SLOT_MAP
  if (sport === 'MLB') return MLB_SLOT_MAP
  return NHL_SLOT_MAP
}

/**
 * Generic position tokens providers use beside the catalog's specific ones (an NBA "G"/"F", an NHL
 * "F"/"W" forward, an MLB generic "P"/"UT"). They are real player positions, not slots.
 */
const EXTRA_POSITION_TOKENS: Record<CatalogSport, string[]> = {
  NBA: ['G', 'F', 'GF', 'FC'],
  MLB: ['P', 'DH', 'UT', 'UTIL', 'IF', 'TWP'],
  NHL: ['F', 'W', 'G', 'D'],
}

/**
 * Every real fantasy position for the sport: the union of the catalog's starter-slot eligible
 * positions (college/bench/reserve rows excluded) plus generic provider tokens.
 * Returns null for NFL and any sport this module does not model.
 */
export function fantasyPositionsForSport(sport: string | null | undefined): Set<string> | null {
  const s = catalogSport(sport)
  if (!s) return null
  const set = new Set<string>(EXTRA_POSITION_TOKENS[s])
  for (const def of slotMapFor(s).values()) {
    if (def.category === 'college' || def.category === 'bench' || def.category === 'reserve') continue
    for (const p of def.eligiblePositions) set.add(p.toUpperCase())
  }
  return set
}

/** True when any token of a (possibly multi-eligible, e.g. "PG/SG", "SP,RP", "C-LW") position is in `set`. */
export function positionInSet(position: string | null | undefined, set: ReadonlySet<string>): boolean {
  const raw = String(position ?? '').trim().toUpperCase()
  if (!raw) return false
  if (set.has(raw)) return true
  return raw.split(/[\/,\-\s]+/).some((tok) => tok && set.has(tok))
}

/** Minimal slot shape (a `RosterTemplateSlotDto` satisfies it). */
export interface RequirementSlot {
  slotName: string
  allowedPositions?: string[] | null
  starterCount?: number | null
  isFlexibleSlot?: boolean | null
}

/**
 * Starter demand per position for an NBA/MLB/NHL roster template, or null for any other sport
 * (the caller keeps its NFL logic).
 *
 * - A DEDICATED slot (catalog category not 'flex', single eligible position) adds its count to that
 *   position — or to the slot name itself when it lists several (MLB "OF" stays "OF").
 * - A FLEX slot (catalog category 'flex', `isFlexibleSlot`, or several allowed positions on a slot the
 *   catalog does not know) spreads its count across the positions IT accepts, preferring those the
 *   league also starts in a dedicated slot (MLB UTIL → C/1B/2B/3B/SS/OF, not LF/CF/RF/DH). Fractional
 *   shares are summed across all flex slots and rounded by largest remainder, so the total demand
 *   added equals the flex slot count — no position outside the sport is ever invented.
 */
export function deriveCatalogStarterRequirements(
  sport: string | null | undefined,
  slots: readonly RequirementSlot[],
): Record<string, number> | null {
  const s = catalogSport(sport)
  if (!s) return null
  const catalog = slotMapFor(s)
  const required: Record<string, number> = {}
  const flex: Array<{ count: number; eligible: string[] }> = []

  for (const slot of slots) {
    const count = Number(slot.starterCount ?? 0)
    if (!(count > 0)) continue
    const name = String(slot.slotName ?? '').trim().toUpperCase()
    const def = catalog.get(name)
    const allowed = (slot.allowedPositions ?? []).map((p) => String(p).trim().toUpperCase()).filter(Boolean)
    const eligible = def && def.eligiblePositions.length > 0 ? def.eligiblePositions.map((p) => p.toUpperCase()) : allowed
    const isFlex = def ? def.category === 'flex' : slot.isFlexibleSlot === true || eligible.length > 1
    if (isFlex && eligible.length > 0) {
      flex.push({ count, eligible })
    } else {
      const pos = eligible.length === 1 ? eligible[0] : name
      required[pos] = (required[pos] ?? 0) + count
    }
  }

  if (flex.length > 0) {
    const share = new Map<string, number>()
    let total = 0
    for (const f of flex) {
      const dedicated = f.eligible.filter((p) => (required[p] ?? 0) > 0)
      const targets = dedicated.length > 0 ? dedicated : f.eligible
      for (const p of targets) share.set(p, (share.get(p) ?? 0) + f.count / targets.length)
      total += f.count
    }
    const entries = [...share.entries()].map(([pos, v], i) => ({ pos, floor: Math.floor(v + 1e-9), rem: v - Math.floor(v + 1e-9), i }))
    let assigned = entries.reduce((sum, e) => sum + e.floor, 0)
    const byRemainder = [...entries].sort((a, b) => b.rem - a.rem || a.i - b.i)
    for (const e of byRemainder) {
      if (assigned >= total) break
      e.floor += 1
      assigned += 1
    }
    for (const e of entries) if (e.floor > 0) required[e.pos] = (required[e.pos] ?? 0) + e.floor
  }

  return required
}

function templateSize(slots: Record<string, number>): number {
  return Object.values(slots).reduce((sum, n) => sum + (Number(n) || 0), 0)
}

function dynastyTemplateSize(templates: ReadonlyArray<{ key: string; slots: Record<string, number> }>): number {
  const t = templates.find((x) => x.key === 'dynasty')
  return t ? templateSize(t.slots) : 0
}

/** NFL's historical ADP cutoff for a non-zero dynasty value. */
export const NFL_DYNASTY_ADP_CUTOFF = 260

/**
 * ADP past which a player carries no dynasty value, scaled by the sport's default DYNASTY roster
 * depth relative to NFL's (MLB 60 slots vs NFL 34 → ~459). Never below NFL's 260, so shallower
 * sports (NBA) keep today's scale; NFL and unknown sports return exactly 260.
 */
export function dynastyAdpCutoff(sport: string | null | undefined): number {
  const s = catalogSport(sport)
  if (!s) return NFL_DYNASTY_ADP_CUTOFF
  const nfl = dynastyTemplateSize(NFL_ROSTER_TEMPLATES)
  const own =
    s === 'NBA'
      ? dynastyTemplateSize(NBA_ROSTER_TEMPLATES)
      : s === 'MLB'
        ? dynastyTemplateSize(MLB_ROSTER_TEMPLATES)
        : dynastyTemplateSize(NHL_ROSTER_TEMPLATES)
  if (!(nfl > 0) || !(own > 0)) return NFL_DYNASTY_ADP_CUTOFF
  return Math.max(NFL_DYNASTY_ADP_CUTOFF, Math.round((NFL_DYNASTY_ADP_CUTOFF * own) / nfl))
}
