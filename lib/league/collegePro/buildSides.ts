/**
 * Shape one half of a college + pro league into the rows the roster page draws.
 *
 * Pure. Both providers already tell us who STARTS. The old panel ignored that and slotted players
 * greedily by name, which is how Brady Cook ended up at QB over Jalen Hurts on Peach Bowl. Sleeper's
 * roster carries `starters` aligned to the league's `roster_positions`; a Fantrax row carries its
 * occupied slot (`position`) and `status` (ACTIVE / RESERVE / INJURED_RESERVE / MINORS).
 *
 * Taxi exists on the PRO half only. The college half never shows one.
 */

export type CollegeProRole = 'pro' | 'college'

export type CollegeProPlayer = {
  id: string
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  logoUrl: string | null
}

export type CollegeProSlotRow = { slot: string; playerId: string | null }

export type CollegeProLists = {
  starters: CollegeProSlotRow[]
  bench: string[]
  taxi: string[]
  ir: string[]
}

/** Sleeper `roster_positions` entries that are not starting slots. */
const NON_STARTER = new Set(['BN', 'TAXI', 'IR', 'RES'])

export function buildSleeperLists(input: {
  positions: string[]
  starters: Array<string | null> | null | undefined
  players: Array<string | null> | null | undefined
  taxi: Array<string | null> | null | undefined
  reserve: Array<string | null> | null | undefined
}): CollegeProLists {
  const clean = (ids: Array<string | null> | null | undefined) =>
    (ids ?? []).filter((id): id is string => typeof id === 'string' && id !== '' && id !== '0')
  const slots = input.positions.filter((p) => !NON_STARTER.has(p))
  const starterIds = input.starters ?? []
  const starters: CollegeProSlotRow[] = slots.map((slot, i) => {
    const id = starterIds[i]
    return { slot, playerId: typeof id === 'string' && id !== '' && id !== '0' ? id : null }
  })
  const taxi = clean(input.taxi)
  const ir = clean(input.reserve)
  const placed = new Set([...starters.map((s) => s.playerId).filter(Boolean), ...taxi, ...ir])
  const bench = [...new Set(clean(input.players))].filter((id) => !placed.has(id))
  return { starters, bench, taxi, ir }
}

/** Fantrax slot codes, in the names the rest of the app colours. */
const FANTRAX_SLOT_NAMES: Record<string, string> = {
  RWT: 'FLEX',
  'RB/WR/TE': 'FLEX',
  WRT: 'FLEX',
  FLX: 'FLEX',
  FLEX: 'FLEX',
  SFX: 'SUPER_FLEX',
  SF: 'SUPER_FLEX',
  'QB/RB/WR/TE': 'SUPER_FLEX',
  SUPERFLEX: 'SUPER_FLEX',
  'WR/TE': 'REC_FLEX',
  'RB/WR': 'WRRB_FLEX',
  'D/ST': 'DEF',
  DST: 'DEF',
}

export function normalizeFantraxSlot(slot: string | null | undefined): string {
  const s = String(slot ?? '').trim().toUpperCase()
  return FANTRAX_SLOT_NAMES[s] ?? (s || 'FLEX')
}

const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'WRRB_FLEX', 'REC_FLEX', 'FLEX', 'SUPER_FLEX', 'K', 'DEF', 'DL', 'LB', 'DB', 'IDP_FLEX']
const slotRank = (slot: string) => {
  const i = SLOT_ORDER.indexOf(slot)
  return i < 0 ? SLOT_ORDER.length : i
}

export function buildFantraxLists(
  rows: Array<{ id: string; slot: string | null; status: string | null }>,
): CollegeProLists {
  const starters: CollegeProSlotRow[] = []
  const bench: string[] = []
  const ir: string[] = []
  for (const row of rows) {
    const status = String(row.status ?? '').trim().toUpperCase()
    if (status === 'ACTIVE') starters.push({ slot: normalizeFantraxSlot(row.slot), playerId: row.id })
    else if (status === 'INJURED_RESERVE' || status === 'IR') ir.push(row.id)
    // RESERVE, MINORS and anything unrecognised sit on the bench: the college half has no taxi.
    else bench.push(row.id)
  }
  // A stable sort keeps Fantrax's own order within a slot type (RB1 before RB2).
  starters.sort((a, b) => slotRank(a.slot) - slotRank(b.slot))
  return { starters, bench, taxi: [], ir }
}
