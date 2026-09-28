/**
 * 🛑 THE LEAGUE'S DRAFT LIST DOES NOT CARRY `slot_to_roster_id` (measured 2026-09-25).
 *
 * The graded ledger resolves a traded pick to the player drafted with it by the ORIGINAL owner's
 * draft slot, and read that slot map off `/league/{id}/drafts`. Sleeper leaves it null there — on
 * Sleeper league 1313185505852018688 both the 2025 and 2026 list entries returned
 * `slot_to_roster_id: null`, while `/draft/{id}` returned all twelve slots — so no resolver was ever
 * built and every used pick in production stayed "2026 round 6", graded as a pick that no longer
 * existed. The used-pick ruling (#1306) had nothing to act on.
 *
 * These run the real ledger builder against a fake Sleeper shaped like that league: the list has no
 * map, the draft does. The fixture is the real trade — roster 1 sent its own 2026 8th (slot 3) to
 * roster 10 and got its own 2026 6th back — and the real picks: Alec Pierce and Kyler Murray.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ routes: new Map<string, unknown>(), calls: [] as string[] }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: { findUnique: async () => null, upsert: async () => ({}) },
  },
}))
vi.mock('@/lib/trade-intel/sleeperTradeSync', () => ({
  sleeperGet: async (path: string) => {
    h.calls.push(path)
    return h.routes.has(path) ? structuredClone(h.routes.get(path)) : null
  },
}))
vi.mock('@/lib/league-context/leagueContextService', () => ({
  getLeagueContext: async () => ({
    scoring: { settings: {}, format: 'ppr' },
    variant: { dynasty: false, keeper: true, idp: false },
    houseRules: {},
  }),
}))
vi.mock('@/lib/sports-data/sleeperMarketService', () => ({
  getSeasonStatsBoard: async () => ({ players: {} }),
  getWeekStatsBoard: async () => null,
  scoreStatLine: () => ({ points: 0 }),
}))

import { getTradeGrades, rosterToDraftSlot } from '@/lib/trade-intel/sleeperTradeGradeService'

const L = 'SL-KEEPER'
const DRAFT = 'D-2026'
const SLOT_MAP = { '1': 3, '2': 5, '3': 1, '4': 7, '5': 8, '6': 2, '7': 12, '8': 9, '9': 6, '10': 4, '11': 11, '12': 10 }
const ROSTERS = [
  { roster_id: 1, owner_id: 'u1' },
  { roster_id: 10, owner_id: 'u10' },
]
const TRADE = {
  transaction_id: 'T-SWAP',
  type: 'trade',
  status: 'complete',
  leg: 1,
  created: 1_786_000_000_000,
  roster_ids: [1, 10],
  adds: null,
  drops: null,
  draft_picks: [
    { season: '2026', round: 8, roster_id: 1, previous_owner_id: 1, owner_id: 10 },
    { season: '2026', round: 6, roster_id: 1, previous_owner_id: 10, owner_id: 1 },
  ],
}
const PICKS = [
  { round: 6, draft_slot: 3, player_id: '5849', picked_by: 'u1', metadata: { first_name: 'Kyler', last_name: 'Murray', position: 'QB' } },
  { round: 8, draft_slot: 3, player_id: '8142', picked_by: 'u10', metadata: { first_name: 'Alec', last_name: 'Pierce', position: 'WR' } },
]

function sleeper(opts: { listHasMap: boolean; draftEndpoint: 'map' | 'order-only' | 'down' }) {
  h.routes.clear()
  h.calls.length = 0
  h.routes.set(`/league/${L}`, { league_id: L, name: 'Keeper', season: '2026', status: 'in_season', previous_league_id: null })
  h.routes.set(`/league/${L}/users`, [
    { user_id: 'u1', display_name: 'One', avatar: null },
    { user_id: 'u10', display_name: 'Ten', avatar: null },
  ])
  h.routes.set(`/league/${L}/rosters`, ROSTERS)
  h.routes.set(`/league/${L}/winners_bracket`, [])
  h.routes.set(`/league/${L}/drafts`, [
    { draft_id: DRAFT, season: '2026', status: 'complete', slot_to_roster_id: opts.listHasMap ? SLOT_MAP : null },
  ])
  h.routes.set(`/league/${L}/transactions/1`, [TRADE])
  h.routes.set(`/draft/${DRAFT}/picks`, PICKS)
  if (opts.draftEndpoint === 'map') {
    h.routes.set(`/draft/${DRAFT}`, { draft_id: DRAFT, season: '2026', status: 'complete', slot_to_roster_id: SLOT_MAP })
  } else if (opts.draftEndpoint === 'order-only') {
    h.routes.set(`/draft/${DRAFT}`, { draft_id: DRAFT, season: '2026', status: 'complete', slot_to_roster_id: null, draft_order: { u1: 3, u10: 4 } })
  }
}

async function picksOfRoster1() {
  const payload = await getTradeGrades(L, { force: true })
  const side = payload?.trades.find((t) => t.id.endsWith(':T-SWAP'))?.sides.find((s) => s.rosterId === 1)
  return { in: side?.picksIn.map((p) => p.resolved?.name ?? null), out: side?.picksOut.map((p) => p.resolved?.name ?? null) }
}

beforeEach(() => vi.clearAllMocks())

describe('🛑 the ledger resolves used picks when the draft list omits the slot map', () => {
  it('reads /draft/{id} for the map and names both picks', async () => {
    sleeper({ listHasMap: false, draftEndpoint: 'map' })
    expect(await picksOfRoster1()).toEqual({ in: ['Kyler Murray'], out: ['Alec Pierce'] })
    expect(h.calls).toContain(`/draft/${DRAFT}`)
  })

  it('falls back to draft_order × roster owners when the draft carries no map either', async () => {
    sleeper({ listHasMap: false, draftEndpoint: 'order-only' })
    expect(await picksOfRoster1()).toEqual({ in: ['Kyler Murray'], out: ['Alec Pierce'] })
  })

  it('a list entry that already carries the map costs no extra call', async () => {
    sleeper({ listHasMap: true, draftEndpoint: 'down' })
    expect(await picksOfRoster1()).toEqual({ in: ['Kyler Murray'], out: ['Alec Pierce'] })
    expect(h.calls).not.toContain(`/draft/${DRAFT}`)
  })

  it('no map anywhere: the picks stay unresolved rather than guessed', async () => {
    sleeper({ listHasMap: false, draftEndpoint: 'down' })
    expect(await picksOfRoster1()).toEqual({ in: [null], out: [null] })
  })
})

describe('rosterToDraftSlot', () => {
  it('inverts slot_to_roster_id', () => {
    const m = rosterToDraftSlot({ slot_to_roster_id: SLOT_MAP }, [])!
    expect(m.get(1)).toBe(3)
    expect(m.get(10)).toBe(12)
    expect(m.size).toBe(12)
  })

  it('accepts string roster ids, as some responses serialise them', () => {
    expect(rosterToDraftSlot({ slot_to_roster_id: { '3': '1' } }, [])!.get(1)).toBe(3)
  })

  it('draft_order is USER → slot, joined to rosters by owner', () => {
    const m = rosterToDraftSlot({ slot_to_roster_id: null, draft_order: { u1: 3, u10: 4, stranger: 9 } }, ROSTERS)!
    expect([...m.entries()].sort()).toEqual([[1, 3], [10, 4]])
  })

  it('an empty map falls through to draft_order; nothing usable is null', () => {
    expect(rosterToDraftSlot({ slot_to_roster_id: {}, draft_order: { u1: 3 } }, ROSTERS)!.get(1)).toBe(3)
    expect(rosterToDraftSlot({ slot_to_roster_id: null, draft_order: null }, ROSTERS)).toBeNull()
    expect(rosterToDraftSlot({ slot_to_roster_id: { x: 'y' } }, ROSTERS)).toBeNull()
  })
})
