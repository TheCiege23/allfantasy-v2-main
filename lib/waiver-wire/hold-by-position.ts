/**
 * The after-drop waiver period, per player type (lib/waiver-wire/dropped-player-waivers.ts reads the
 * drops; this is the pure part). A league has one period, `League.waiverHours`; a commissioner can
 * give any position its own in `waiverEngineConfig.dropped_player_hold_hours_by_position` — e.g.
 * K and DEF clear in 0 hours while everyone else waits 24, or a QB waits 48. Pure, so the hub, the
 * settings validator and the waiver engine all read it the same way.
 */

/** The league's after-drop waiver period in hours, or 0 when it has none (FCFS, or 0 hours). */
export function droppedPlayerWaiverHours(input: {
  normalizedWaiverType: string | null | undefined
  waiverHours: number | null | undefined
}): number {
  if (input.normalizedWaiverType === 'fcfs') return 0
  const h = Number(input.waiverHours)
  return Number.isFinite(h) && h > 0 ? h : 0
}

/** The longest per-position period accepted, matching the hub's waiver-period ceiling (a week). */
export const MAX_HOLD_HOURS = 168

/** `waiverEngineConfig` key holding the per-position periods, `{ [position]: hours }`. */
export const HOLD_HOURS_BY_POSITION_KEY = 'dropped_player_hold_hours_by_position'

/** Spellings of one position, and the group keys that cover several. */
const POSITION_ALIASES: Record<string, string> = { DST: 'DEF', 'D/ST': 'DEF', PK: 'K' }
const POSITION_GROUPS: Record<string, string> = { DE: 'DL', DT: 'DL', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB' }

/** One position token, upper-cased and de-aliased; the first of a multi-position string. */
export function normalizeHoldPosition(raw: unknown): string {
  const first = String(raw ?? '').trim().toUpperCase().split(/[,|]|\s+/)[0] ?? ''
  const token = first === 'D/ST' ? first : (first.split('/')[0] ?? '')
  return POSITION_ALIASES[token] ?? token
}

/**
 * A configured key — one position or group, as the hub saves it. Stricter than a player's position:
 * nothing is split off, so "not a position" is refused rather than read as "NOT". Null when invalid.
 */
function holdKey(raw: string): string | null {
  const k = raw.trim().toUpperCase()
  if (k !== 'D/ST' && !/^[A-Z0-9]{1,4}$/.test(k)) return null
  return POSITION_ALIASES[k] ?? k
}

/**
 * The stored per-position periods, cleaned: known-shape keys, whole hours 0–168. Anything else is
 * dropped rather than guessed at.
 */
export function readHoldHoursByPosition(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const pos = holdKey(k)
    const h = typeof v === 'number' ? v : NaN
    if (!pos || !Number.isInteger(h) || h < 0 || h > MAX_HOLD_HOURS) continue
    out[pos] = h
  }
  return out
}

/**
 * Validates a hub save of the per-position periods. `null` or `{}` clears them. Returns the cleaned
 * map, or the reason it is refused — never a silently trimmed copy of what was sent.
 */
export function parseHoldHoursByPositionInput(raw: unknown): { ok: true; value: Record<string, number> } | { ok: false; error: string } {
  if (raw === null) return { ok: true, value: {} }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Invalid waiverHoldHoursByPosition' }
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > 20) return { ok: false, error: 'Too many positions in waiverHoldHoursByPosition' }
  const value: Record<string, number> = {}
  for (const [k, v] of entries) {
    const pos = holdKey(k)
    if (!pos) return { ok: false, error: `Unknown position "${k}"` }
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_HOLD_HOURS) {
      return { ok: false, error: `The waiver period for ${pos} must be a whole number of hours, 0–${MAX_HOLD_HOURS}.` }
    }
    value[pos] = v
  }
  return { ok: true, value }
}

export type DroppedPlayerHoldPolicy = {
  /** The league period: any position not listed. */
  hours: number
  /** Per-position periods; empty when the league has none. */
  byPosition: Readonly<Record<string, number>>
  /** The league's sport, so a position lookup does not match another sport's player. */
  sport?: string | null
}

/** The league's policy: FCFS has no hold at all; otherwise the league period plus any overrides. */
export function droppedPlayerHoldPolicy(input: {
  normalizedWaiverType: string | null | undefined
  waiverHours: number | null | undefined
  waiverEngineConfig?: unknown
  sport?: string | null
}): DroppedPlayerHoldPolicy {
  if (input.normalizedWaiverType === 'fcfs') return { hours: 0, byPosition: {}, sport: input.sport ?? null }
  const engine = input.waiverEngineConfig && typeof input.waiverEngineConfig === 'object' ? (input.waiverEngineConfig as Record<string, unknown>) : {}
  return {
    hours: droppedPlayerWaiverHours(input),
    byPosition: readHoldHoursByPosition(engine[HOLD_HOURS_BY_POSITION_KEY]),
    sport: input.sport ?? null,
  }
}

/** The period for a player of `position`: its own, else its group's, else the league's. */
export function holdHoursForPosition(policy: DroppedPlayerHoldPolicy, position: string | null | undefined): number {
  const pos = normalizeHoldPosition(position)
  if (pos && policy.byPosition[pos] !== undefined) return policy.byPosition[pos]
  const group = POSITION_GROUPS[pos]
  if (group && policy.byPosition[group] !== undefined) return policy.byPosition[group]
  return policy.hours
}

/** The longest period any dropped player can be held under the policy; 0 means no holds at all. */
export function maxHoldHours(policy: DroppedPlayerHoldPolicy): number {
  return Math.max(policy.hours, 0, ...Object.values(policy.byPosition))
}


/**
 * The positions the hub offers a period for, by sport. A sport not listed offers none (its
 * existing overrides still show and can be removed).
 */
const HOLD_POSITION_OPTIONS: Record<string, readonly string[]> = {
  NFL: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'],
  NCAAF: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'],
  NBA: ['PG', 'SG', 'SF', 'PF', 'C'],
  NCAAB: ['G', 'F', 'C'],
  MLB: ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP'],
  NHL: ['C', 'LW', 'RW', 'D', 'G'],
}

export function holdPositionOptions(sport: string | null | undefined): readonly string[] {
  const key = String(sport ?? '').trim().toUpperCase()
  return HOLD_POSITION_OPTIONS[key === 'NCAAFB' ? 'NCAAF' : key === 'NCAABB' ? 'NCAAB' : key] ?? []
}
