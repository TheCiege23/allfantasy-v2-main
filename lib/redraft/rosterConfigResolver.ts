/**
 * Canonical redraft roster-config resolver (G10).
 *
 * Lineup validation must follow the COMMISSIONER'S configured roster, not a static
 * starter assumption. This resolves the league's slot layout from the canonical
 * store — `League.settings.roster.config.sections[].slots`
 * (e.g. `{ QB:1, RB:2, WR:2, TE:1, FLEX:1, DEF:1, K:1, BN:6, IR:1 }`) — with
 * defensive fallbacks to legacy shapes and finally the sport-config defaults.
 *
 * Output separates starter capacities (by normalized slot token: QB/RB/WR/TE/FLX/
 * SF/DEF/K/IDP_*) from bench / IR / taxi counts, and computes max roster size.
 * Pure + deterministic so it is unit-tested without a database. Eligibility (which
 * positions fit a flex slot) stays in `lineupValidation` via the sport config.
 */
import { getRedraftSportConfig } from '@/lib/redraft/sportConfig'
import { normalizeToken } from '@/lib/redraft/lineupValidation'

export type ResolvedRosterConfig = {
  /** Normalized starter slot token → capacity (QB, RB, WR, TE, FLX, SF, DEF, K, IDP_*). */
  starterCapacities: Map<string, number>
  benchSlots: number
  irSlots: number
  taxiSlots: number
  /** starters + bench + IR + taxi. */
  maxRosterSize: number
  /** Where the layout came from — 'commissioner' (league settings) or 'defaults'. */
  source: 'commissioner' | 'defaults'
}

const BENCH_TOKENS = new Set(['BENCH', 'BN'])
const IR_TOKENS = new Set(['IR', 'RESERVE'])
const TAXI_TOKENS = new Set(['TAXI', 'DEVY'])

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Extract a raw `{ slot: count }` map from the canonical/legacy settings shapes. */
function extractRawSlotMap(leagueSettings: unknown): Record<string, number> | null {
  const s = isRecord(leagueSettings) ? leagueSettings : {}

  // Canonical: settings.roster.config.sections[].slots (merge all sections).
  const roster = isRecord(s.roster) ? s.roster : null
  const config = roster && isRecord(roster.config) ? roster.config : null
  const sections = config && Array.isArray(config.sections) ? config.sections : null
  if (sections && sections.length > 0) {
    const merged: Record<string, number> = {}
    let found = false
    for (const section of sections) {
      const slots = isRecord(section) && isRecord(section.slots) ? section.slots : null
      if (!slots) continue
      for (const [k, v] of Object.entries(slots)) {
        const n = Number(v)
        if (Number.isFinite(n)) {
          merged[k] = (merged[k] ?? 0) + n
          found = true
        }
      }
    }
    if (found) return merged
  }

  // Legacy fallbacks.
  for (const candidate of [s.starter_slots, isRecord(s.roster) ? s.roster.starter_slots : null, isRecord(s.roster) ? s.roster.starterSlots : null, isRecord(s.sportConfig) ? (s.sportConfig as Record<string, unknown>).starterSlots : null]) {
    if (isRecord(candidate)) {
      const map: Record<string, number> = {}
      let found = false
      for (const [k, v] of Object.entries(candidate)) {
        const n = Number(v)
        if (Number.isFinite(n)) {
          map[k] = n
          found = true
        }
      }
      if (found) return map
    }
  }
  return null
}

/** Defaults from the static sport config (used when settings carry no roster layout). */
function defaultsFor(sport: string): ResolvedRosterConfig {
  const cfg = getRedraftSportConfig(sport)
  const starterCapacities = new Map<string, number>()
  for (const slot of cfg.starterSlots) {
    const t = normalizeToken(slot)
    starterCapacities.set(t, (starterCapacities.get(t) ?? 0) + 1)
  }
  const benchSlots = Math.max(0, Math.floor(Number(cfg.benchSlots ?? 0)))
  const irSlots = Math.max(0, Math.floor(Number(cfg.irSlots ?? 0)))
  const taxiSlots = 0
  const starters = [...starterCapacities.values()].reduce((a, b) => a + b, 0)
  return { starterCapacities, benchSlots, irSlots, taxiSlots, maxRosterSize: starters + benchSlots + irSlots + taxiSlots, source: 'defaults' }
}

export function resolveRedraftRosterConfig(sport: string, leagueSettings: unknown): ResolvedRosterConfig {
  const raw = extractRawSlotMap(leagueSettings)
  if (!raw) return defaultsFor(sport)

  const starterCapacities = new Map<string, number>()
  let benchSlots = 0
  let irSlots = 0
  let taxiSlots = 0

  for (const [rawKey, rawCount] of Object.entries(raw)) {
    const count = Math.max(0, Math.floor(Number(rawCount ?? 0)))
    if (count <= 0) continue
    const token = normalizeToken(rawKey)
    if (BENCH_TOKENS.has(token)) benchSlots += count
    else if (IR_TOKENS.has(token)) irSlots += count
    else if (TAXI_TOKENS.has(token)) taxiSlots += count
    else starterCapacities.set(token, (starterCapacities.get(token) ?? 0) + count)
  }

  // Bench/IR can also live outside the slots map on some shapes — honor explicit
  // values if the slots map didn't include them.
  const s = isRecord(leagueSettings) ? leagueSettings : {}
  const roster = isRecord(s.roster) ? s.roster : {}
  const sportConfig = isRecord(s.sportConfig) ? s.sportConfig : {}
  const num = (...vals: unknown[]): number | null => {
    for (const v of vals) {
      const n = Number(v)
      if (Number.isFinite(n) && n >= 0) return Math.floor(n)
    }
    return null
  }
  if (benchSlots === 0) benchSlots = num(roster.benchSlots, (sportConfig as Record<string, unknown>).benchSlots) ?? 0
  if (irSlots === 0) irSlots = num(roster.irSlots, (sportConfig as Record<string, unknown>).irSlots) ?? 0
  if (taxiSlots === 0) taxiSlots = num(roster.taxiSlots, (sportConfig as Record<string, unknown>).taxiSlots) ?? 0

  if (starterCapacities.size === 0) return defaultsFor(sport)

  const starters = [...starterCapacities.values()].reduce((a, b) => a + b, 0)
  return {
    starterCapacities,
    benchSlots,
    irSlots,
    taxiSlots,
    maxRosterSize: starters + benchSlots + irSlots + taxiSlots,
    source: 'commissioner',
  }
}
