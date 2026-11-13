/**
 * Canonical roster-slot ordering for draft room roster panels.
 *
 * Standard redraft:
 *   QB | RB | WR | WR | TE | DEF | BN
 *
 * Optional slot order:
 *   FLX directly below TE, SF below FLX or below TE, DEF above IDP, bench last.
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
}

function normalizeSlotKey(key: string): string {
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

  const expandPosition = (position: string, kind: 'starter' | 'custom') => {
    const count = Math.max(0, Math.floor(Number(slots[position] ?? 0)))
    for (let i = 1; i <= count; i += 1) {
      out.push({
        position,
        occurrence: i,
        label: count > 1 ? `${position}${i}` : position,
        kind,
      })
    }
  }

  for (const pos of CANONICAL_OFFENSE_ORDER) expandPosition(pos, 'starter')
  for (const pos of CANONICAL_TAIL_ORDER) expandPosition(pos, 'starter')

  if (input.idpEnabled) {
    for (const pos of CANONICAL_IDP_ORDER) expandPosition(pos, 'starter')
  }

  const customPositions = Object.keys(slots)
    .filter((k) => !CANONICAL_KEYS.has(normalizeSlotKey(k)) && (slots[k] ?? 0) > 0)
    .sort((a, b) => a.localeCompare(b))
  for (const pos of customPositions) expandPosition(pos, 'custom')

  const benchCount = Math.max(0, Math.floor(Number(input.benchSlots ?? 0)))
  for (let i = 1; i <= benchCount; i += 1) {
    out.push({
      position: 'BN',
      occurrence: i,
      label: benchCount > 1 ? `BN${i}` : 'BN',
      kind: 'bench',
    })
  }

  return out
}

export function assignPicksToSlots<P extends { position: string; playerName?: string }>(
  picks: readonly P[],
  slotOrder: readonly RosterSlotEntry[],
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
