/**
 * IDP post-trade lineup check: warn when a trade would leave a team unable to field a legal IDP lineup.
 */

import { getRosterDefaultsForIdpLeague } from '@/lib/idp/IDPLeagueConfig'

const IDP_POSITIONS = new Set(['DE', 'DT', 'LB', 'CB', 'S', 'SS', 'FS'])
const IDP_SLOT_KEYS = ['DE', 'DT', 'LB', 'CB', 'S', 'DL', 'DB', 'IDP_FLEX']

/**
 * Total number of IDP starter slots from league roster defaults.
 */
export async function getTotalIdpStarterSlots(leagueId: string): Promise<number> {
  const defaults = await getRosterDefaultsForIdpLeague(leagueId)
  if (!defaults?.starter_slots) return 0
  let n = 0
  for (const key of IDP_SLOT_KEYS) {
    const count = defaults.starter_slots[key]
    if (typeof count === 'number' && count > 0) n += count
  }
  return n
}

/**
 * Count players that are IDP-eligible (position in DE, DT, LB, CB, S, SS, FS).
 */
function countIdpEligible(positions: (string | null | undefined)[]): number {
  return positions.filter((p) => p && IDP_POSITIONS.has((p as string).trim().toUpperCase())).length
}

/**
 * True if the roster has enough IDP-eligible players to fill required IDP starter slots.
 */
export function canFieldLegalIdpLineup(
  positions: (string | null | undefined)[],
  requiredIdpSlots: number
): boolean {
  if (requiredIdpSlots <= 0) return true
  return countIdpEligible(positions) >= requiredIdpSlots
}

/**
 * Build post-trade position list: roster positions minus given positions, plus received positions.
 * rosterEntries: array of { name, position } or string (name only)
 * givenNames: names of players being traded away
 * receivedPositions: positions of players being received (same order as received names if needed)
 */
export function postTradePositions(
  rosterEntries: Array<{ name?: string; position?: string } | string>,
  givenNames: string[],
  receivedPositions: (string | null | undefined)[]
): (string | null)[] {
  const givenSet = new Set(givenNames.map((n) => (n || '').trim().toLowerCase()))
  const kept = rosterEntries
    .map((e) => {
      const name = typeof e === 'string' ? e : (e?.name ?? '').trim()
      if (!name || givenSet.has(name.toLowerCase())) return null
      return typeof e === 'string' ? null : (e?.position ?? null)
    })
    .filter((p): p is string | null => p !== undefined)
  const received = receivedPositions.map((p) => (p === undefined ? null : p))
  return [...kept, ...received]
}
