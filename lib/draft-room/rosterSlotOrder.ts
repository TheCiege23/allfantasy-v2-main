/**
 * Canonical roster-slot ordering for draft room roster panels.
 *
 * Standard redraft:
 *   QB | RB | WR | WR | TE | DEF | BN
 *
 * Optional slot order:
 *   FLX directly below TE, SF below FLX or below TE, DEF above IDP, bench last.
 *
 * Other sports (2026-11-19) read the way their own lineup screens do — basketball
 * PG SG G SF PF F C UTIL, baseball C 1B 2B 3B SS … OF UTIL SP RP P, hockey C LW RW D UTIL G,
 * soccer GK DEF MID FWD — and fill flex slots by that sport's eligibility (a PG fills G, then
 * UTIL; a 1B fills CI; an LW fills W, then F). Pass `sport`; without it the football order stands.
 */

const CANONICAL_OFFENSE_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLX', 'SF'] as const
const CANONICAL_TAIL_ORDER = ['DEF', 'K'] as const
const CANONICAL_IDP_ORDER = ['DL', 'LB', 'DB', 'IDP'] as const

const CANONICAL_KEYS = new Set<string>([
  ...CANONICAL_OFFENSE_ORDER,
  ...CANONICAL_TAIL_ORDER,
  ...CANONICAL_IDP_ORDER,
  'FLEX',
  'SUPERFLEX',
  'SUPER_FLEX',
  'DST',
  'D/ST',
  'IDP FLEX',
  'IDP_FLEX',
  'BN',
])

export interface RosterSlotEntry {
  position: string
  occurrence: number
  label: string
  kind: 'starter' | 'bench' | 'custom'
}

interface RosterSlotOrderInput {
  starterSlots: Record<string, number> | null | undefined
  benchSlots?: number | null
  idpEnabled?: boolean
  /** Sport code (NFL, NBA, MLB, NHL, SOCCER, NCAAF, NCAAB…). Football order when absent. */
  sport?: string | null
}

type SportFamily = 'football' | 'basketball' | 'baseball' | 'hockey' | 'soccer'

/** Which lineup family a sport code belongs to; unknown codes read as football, as before. */
export function rosterSportFamily(sport: string | null | undefined): SportFamily {
  const code = String(sport ?? '').trim().toUpperCase()
  if (code === 'NBA' || code === 'NCAAB' || code === 'NCAABB' || code === 'WNBA') return 'basketball'
  if (code === 'MLB') return 'baseball'
  if (code === 'NHL') return 'hockey'
  if (code === 'SOCCER' || code === 'MLS' || code === 'EPL') return 'soccer'
  return 'football'
}

/** Bye weeks are a football idea; every other sport plays through the week. */
export function sportHasByeWeeks(sport: string | null | undefined): boolean {
  return rosterSportFamily(sport) === 'football'
}

const SPORT_SLOT_ORDER: Record<Exclude<SportFamily, 'football'>, readonly string[]> = {
  basketball: ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL'],
  baseball: ['C', '1B', '2B', '3B', 'SS', 'CI', 'MI', 'OF', 'LF', 'CF', 'RF', 'DH', 'UTIL', 'SP', 'RP', 'P'],
  hockey: ['C', 'LW', 'RW', 'W', 'F', 'D', 'UTIL', 'G'],
  soccer: ['GK', 'DEF', 'D', 'MID', 'M', 'FWD', 'F', 'UTIL', 'FLX'],
}

/** Slots a player of `position` may fill in `family`, best fit first (bench comes after all of them). */
function eligibleSlotsFor(family: Exclude<SportFamily, 'football'>, position: string): string[] {
  const one = (pos: string): string[] => {
    switch (family) {
      case 'basketball':
        if (pos === 'PG' || pos === 'SG') return [pos, 'G', 'UTIL']
        if (pos === 'SF' || pos === 'PF') return [pos, 'F', 'UTIL']
        return [pos, 'UTIL']
      case 'baseball':
        if (pos === '1B' || pos === '3B') return [pos, 'CI', 'UTIL']
        if (pos === '2B' || pos === 'SS') return [pos, 'MI', 'UTIL']
        if (pos === 'LF' || pos === 'CF' || pos === 'RF') return [pos, 'OF', 'UTIL']
        if (pos === 'SP' || pos === 'RP') return [pos, 'P']
        if (pos === 'P') return ['P']
        return [pos, 'UTIL']
      case 'hockey':
        if (pos === 'LW' || pos === 'RW') return [pos, 'W', 'F', 'UTIL']
        if (pos === 'C') return ['C', 'F', 'UTIL']
        if (pos === 'G') return ['G']
        return [pos, 'UTIL']
      case 'soccer':
        if (pos === 'GK' || pos === 'G') return ['GK']
        if (pos === 'DEF' || pos === 'D') return ['DEF', 'D', 'UTIL', 'FLX']
        if (pos === 'MID' || pos === 'M') return ['MID', 'M', 'UTIL', 'FLX']
        if (pos === 'FWD' || pos === 'F') return ['FWD', 'F', 'UTIL', 'FLX']
        return [pos, 'UTIL', 'FLX']
    }
  }
  // Dual-eligible players ("PG/SG", "G-F", "2B,SS") take the union, each part's best fit first.
  const parts = String(position ?? '').toUpperCase().split(/[\/,-]/).map((p) => p.trim()).filter(Boolean)
  const firsts = parts.map((p) => one(p)[0]!)
  const rest = parts.flatMap((p) => one(p).slice(1))
  return Array.from(new Set([...firsts, ...rest]))
}

/** Short roster-slot code: FLEX -> FLX, SUPERFLEX -> SF, DST -> DEF, IDP_FLEX -> IDP. */
export function normalizeSlotKey(key: string): string {
  const value = String(key ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  if (value === 'FLEX') return 'FLX'
  if (value === 'SUPERFLEX' || value === 'SUPER FLEX' || value === 'SUPER_FLEX') return 'SF'
  if (value === 'DST' || value === 'D/ST' || value === 'DEFENSE') return 'DEF'
  if (value === 'IDP FLEX' || value === 'IDP_FLEX') return 'IDP'
  return value
}

function normalizedSlotCounts(starterSlots: Record<string, number> | null | undefined): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const [rawKey, rawCount] of Object.entries(starterSlots ?? {})) {
    const key = normalizeSlotKey(rawKey)
    counts[key] = (counts[key] ?? 0) + Math.max(0, Math.floor(Number(rawCount ?? 0)))
  }
  return counts
}

export function buildOrderedRosterSlots(input: RosterSlotOrderInput): RosterSlotEntry[] {
  const slots = normalizedSlotCounts(input.starterSlots)
  const out: RosterSlotEntry[] = []
  const family = rosterSportFamily(input.sport)

  const expandPosition = (position: string, kind: 'starter' | 'custom') => {
    const count = Math.max(0, Math.floor(Number(slots[position] ?? 0)))
    for (let i = 1; i <= count; i += 1) {
      out.push({
        position,
        occurrence: i,
        // Plain slot names (2026-11-19): "WR", never "WR1 / WR2". The number told a manager
        // nothing, and a draft roster reads like the lineup screen this way.
        label: position,
        kind,
      })
    }
  }

  if (family === 'football') {
    for (const pos of CANONICAL_OFFENSE_ORDER) expandPosition(pos, 'starter')
    for (const pos of CANONICAL_TAIL_ORDER) expandPosition(pos, 'starter')

    if (input.idpEnabled) {
      for (const pos of CANONICAL_IDP_ORDER) expandPosition(pos, 'starter')
    }

    const customPositions = Object.keys(slots)
      .filter((k) => !CANONICAL_KEYS.has(normalizeSlotKey(k)) && (slots[k] ?? 0) > 0)
      .sort((a, b) => a.localeCompare(b))
    for (const pos of customPositions) expandPosition(pos, 'custom')
  } else {
    const order = SPORT_SLOT_ORDER[family]
    for (const pos of order) expandPosition(pos, 'starter')
    const known = new Set<string>(order)
    const customPositions = Object.keys(slots)
      .filter((k) => !known.has(k) && k !== 'BN' && (slots[k] ?? 0) > 0)
      .sort((a, b) => a.localeCompare(b))
    for (const pos of customPositions) expandPosition(pos, 'custom')
  }

  const benchCount = Math.max(0, Math.floor(Number(input.benchSlots ?? 0)))
  for (let i = 1; i <= benchCount; i += 1) {
    out.push({
      position: 'BN',
      occurrence: i,
      label: 'BN',
      kind: 'bench',
    })
  }

  return out
}

export function assignPicksToSlots<P extends { position: string; playerName?: string }>(
  picks: readonly P[],
  slotOrder: readonly RosterSlotEntry[],
  sport?: string | null,
): Array<{ slot: RosterSlotEntry; pick: P | null }> {
  const result: Array<{ slot: RosterSlotEntry; pick: P | null }> = slotOrder.map((slot) => ({
    slot,
    pick: null,
  }))

  const tryPlace = (pick: P, predicate: (slot: RosterSlotEntry) => boolean) => {
    for (let i = 0; i < result.length; i += 1) {
      if (result[i]!.pick != null) continue
      if (predicate(result[i]!.slot)) {
        result[i] = { slot: result[i]!.slot, pick }
        return true
      }
    }
    return false
  }

  const family = rosterSportFamily(sport)
  if (family !== 'football') {
    for (const pick of picks) {
      const eligible = eligibleSlotsFor(family, pick.position)
      if (eligible.some((slotPos) => tryPlace(pick, (s) => s.kind !== 'bench' && s.position === slotPos))) continue
      tryPlace(pick, (s) => s.kind === 'bench')
    }
    return result
  }

  for (const pick of picks) {
    const pos = String(pick.position ?? '').toUpperCase()
    if (tryPlace(pick, (s) => s.position === pos)) continue
    if ((pos === 'RB' || pos === 'WR' || pos === 'TE') && tryPlace(pick, (s) => s.position === 'FLX')) continue
    if (
      (pos === 'QB' || pos === 'RB' || pos === 'WR' || pos === 'TE') &&
      tryPlace(pick, (s) => s.position === 'SF')
    ) continue
    if ((pos === 'DL' || pos === 'LB' || pos === 'DB') && tryPlace(pick, (s) => s.position === 'IDP')) continue
    tryPlace(pick, (s) => s.kind === 'bench')
  }

  return result
}
