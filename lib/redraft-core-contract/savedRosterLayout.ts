/**
 * The league's OWN saved roster layout, for NFL / NCAAF redraft leagues.
 *
 * 🛑 A LEAGUE THAT HAS SAVED ANY ROSTER LAYOUT KEEPS EXACTLY THAT LAYOUT (owner, 2026-10-20). Defaults
 * apply only to a league with no saved layout at all. This module is the one definition of "has a saved
 * layout" and of "what that layout is", shared by the write path that repairs a league
 * (`ensureRedraftLeagueContract`) and the read paths that show one (`/api/league/roster`,
 * `RosterTemplateService.getRosterTemplate`). Before it existed, the repair merged the default starters
 * INTO saved layouts and the read paths showed the default lineup INSTEAD of the saved one, so a league
 * saved with QB, RB, WR, WR, TE, DEF was repaired to carry FLX and K and displayed with empty FLEX / K
 * slots.
 *
 * Pure: no database access.
 */
import { normalizeRedraftRosterSlotKey } from '@/lib/league-concepts/redraftDefaults'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'

type JsonRecord = Record<string, unknown>
export type FootballRedraftLayoutSport = 'NFL' | 'NCAAF'

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyRecord(value: unknown): value is JsonRecord {
  return isRecord(value) && Object.keys(value).length > 0
}

function nonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0
}

export function firstPositive(...values: unknown[]): number | null {
  for (const value of values) {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
  }
  return null
}

const BENCH_KEYS = new Set(['BN'])
const IR_KEYS = new Set(['IR', 'RESERVE', 'IL', 'IL_PLUS', 'NA'])
const OTHER_NON_STARTER_KEYS = new Set(['TAXI', 'DEVY', 'PROSPECT', 'RIGHTS', 'MINORS'])

function isNonStarterKey(key: string): boolean {
  return BENCH_KEYS.has(key) || IR_KEYS.has(key) || OTHER_NON_STARTER_KEYS.has(key)
}

/** Canonical display order: the redraft contract's QB, RB, WR, TE, FLX, K, SF, DEF, then IDP. */
const CANONICAL_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLX', 'K', 'SF', 'DEF', 'DL', 'LB', 'DB', 'IDP']

const ORDER_ARRAY_KEYS = ['starter_slot_order', 'roster_slot_order', 'compact_roster_slot_order', 'roster_positions', 'rosterPositions'] as const

/** A saved starter MAP, in whichever of the three shapes the league carries. */
export function readSavedStarterSlots(settings: unknown): JsonRecord | null {
  const s = isRecord(settings) ? settings : {}
  if (nonEmptyRecord(s.starter_slots)) return s.starter_slots
  if (isRecord(s.rosterTemplate) && nonEmptyRecord(s.rosterTemplate.starterSlots)) return s.rosterTemplate.starterSlots
  if (isRecord(s.rosterSettings) && nonEmptyRecord(s.rosterSettings.starterSlots)) return s.rosterSettings.starterSlots
  return null
}

/**
 * True when the league has saved ANY roster layout: a non-empty starter map, a slot-order /
 * roster-positions array, or anything `resolveRedraftRosterConfig` (lineup validation's reader)
 * finds — including a commissioner's `roster.config.sections`.
 */
export function hasSavedRosterLayout(sport: FootballRedraftLayoutSport, settings: unknown): boolean {
  const s = isRecord(settings) ? settings : {}
  if (readSavedStarterSlots(s)) return true
  for (const key of ORDER_ARRAY_KEYS) {
    if (nonEmptyArray(s[key])) return true
  }
  return resolveRedraftRosterConfig(sport, s).source === 'commissioner'
}

export type SavedRosterLayout = {
  /** One canonical token per starter slot (QB, RB, RB, WR, …, FLX, K, SF, DEF), in display order. */
  starterOrder: string[]
  /** Saved bench count, or null when the league never saved one. */
  benchSlots: number | null
  /** Saved IR count, or null when the league never saved one. */
  irSlots: number | null
}

function orderCounts(counts: Record<string, number>): string[] {
  const keys = Object.keys(counts).filter((key) => counts[key] > 0)
  const known = CANONICAL_ORDER.filter((key) => keys.includes(key))
  const unknown = keys.filter((key) => !CANONICAL_ORDER.includes(key))
  return [...known, ...unknown].flatMap((key) => Array.from({ length: counts[key] }, () => key))
}

/**
 * The league's saved layout, or null when it has none (and only then may a caller use the defaults).
 * Read in the same precedence as the shapes are written: an explicit starter order first, then a
 * starter map, then the commissioner config, then any roster-order array.
 */
export function readSavedRosterLayout(
  sport: FootballRedraftLayoutSport,
  settings: unknown,
): SavedRosterLayout | null {
  const s = isRecord(settings) ? settings : {}
  if (!hasSavedRosterLayout(sport, s)) return null

  const rosterSettings = isRecord(s.rosterSettings) ? s.rosterSettings : {}
  const rosterTemplate = isRecord(s.rosterTemplate) ? s.rosterTemplate : {}
  const resolved = resolveRedraftRosterConfig(sport, s)
  let benchFromLayout: number | null = null
  let irFromLayout: number | null = null
  let starterOrder: string[] = []

  const fromArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []
    const out: string[] = []
    let bench = 0
    let ir = 0
    for (const raw of value) {
      const key = normalizeRedraftRosterSlotKey(raw)
      if (!key) continue
      if (BENCH_KEYS.has(key)) bench += 1
      else if (IR_KEYS.has(key)) ir += 1
      else if (!OTHER_NON_STARTER_KEYS.has(key)) out.push(key)
    }
    if (bench > 0 && benchFromLayout == null) benchFromLayout = bench
    if (ir > 0 && irFromLayout == null) irFromLayout = ir
    return out
  }

  starterOrder = fromArray(s.starter_slot_order)

  if (starterOrder.length === 0) {
    const map = readSavedStarterSlots(s)
    if (map) {
      const counts: Record<string, number> = {}
      for (const [raw, value] of Object.entries(map)) {
        const key = normalizeRedraftRosterSlotKey(raw)
        const count = firstPositive(value) ?? 0
        if (!key || count <= 0) continue
        if (BENCH_KEYS.has(key)) benchFromLayout = count
        else if (IR_KEYS.has(key)) irFromLayout = count
        else if (!isNonStarterKey(key)) counts[key] = (counts[key] ?? 0) + count
      }
      starterOrder = orderCounts(counts)
    }
  }

  if (starterOrder.length === 0 && resolved.source === 'commissioner') {
    const counts: Record<string, number> = {}
    for (const [token, count] of resolved.starterCapacities) {
      const key = normalizeRedraftRosterSlotKey(token)
      if (key && !isNonStarterKey(key)) counts[key] = (counts[key] ?? 0) + count
    }
    starterOrder = orderCounts(counts)
  }

  if (starterOrder.length === 0) {
    for (const key of ORDER_ARRAY_KEYS) {
      starterOrder = fromArray(s[key])
      if (starterOrder.length > 0) break
    }
  }

  return {
    starterOrder,
    benchSlots: firstPositive(
      resolved.source === 'commissioner' ? resolved.benchSlots : null,
      s.bench_slots,
      rosterSettings.benchSlots,
      rosterTemplate.benchSlots,
      benchFromLayout,
    ),
    irSlots: firstPositive(
      resolved.source === 'commissioner' ? resolved.irSlots : null,
      s.ir_slots,
      rosterSettings.irSlots,
      rosterTemplate.irSlots,
      irFromLayout,
    ),
  }
}

/** Positions a canonical starter token accepts. */
export function allowedPositionsForCanonicalSlot(token: string): string[] {
  switch (token) {
    case 'FLX':
      return ['RB', 'WR', 'TE']
    case 'SF':
      return ['QB', 'RB', 'WR', 'TE']
    case 'DEF':
      return ['DEF', 'DST', 'D/ST']
    case 'DL':
      return ['DE', 'DT', 'DL']
    case 'DB':
      return ['CB', 'S', 'DB']
    case 'IDP':
      return ['DE', 'DT', 'DL', 'LB', 'CB', 'S', 'DB']
    default:
      return [token]
  }
}

export function isFlexibleCanonicalSlot(token: string): boolean {
  return token === 'FLX' || token === 'SF' || token === 'DL' || token === 'DB' || token === 'IDP'
}
