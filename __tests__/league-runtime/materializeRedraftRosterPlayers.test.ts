/**
 * Projecting `Roster.playerData` into `RedraftRosterPlayer`.
 *
 * 🛑 THE GAP THIS CLOSES. `canonicalSeasonMaterialization` created a `RedraftRoster` per team and
 * stopped. Every writer of `RedraftRosterPlayer` is a transaction path — draft finalisation,
 * waivers, keeper carryover, the devy merge, the IDP bridge — and none of those runs on an imported
 * league. So an imported roster was materialised empty and stayed empty. Measured on production
 * 2026-09-04:
 *
 *     redraft rosters with NO players    3,039 of 3,130  (97%)
 *     guillotine / zombie / survivor     100% of them
 *
 * `captureSnapshot` builds its team profile from `roster.players` and reads their positions to
 * judge depth, so an empty roster produced no profile and the trade verdict fell back to "we could
 * not price enough of this deal". The valuation was fine. There was nothing to value.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rosterFindMany: vi.fn(),
  rrpFindMany: vi.fn(),
  rrpCreate: vi.fn(),
  reconcile: vi.fn(),
  normalized: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findMany: h.rosterFindMany },
    redraftRosterPlayer: { findMany: h.rrpFindMany, create: h.rrpCreate },
  },
}))
vi.mock('@/lib/league-runtime/reconcileRosterRedraftLinks', () => ({
  reconcileRosterRedraftLinks: h.reconcile,
}))
vi.mock('@/lib/player-data/getNormalizedPlayerData', () => ({
  getNormalizedPlayerData: h.normalized,
}))
/* Identity, for the same reason the rosters-route test mocks it: what is under test is the
 * projection, and driving the real serializer means satisfying its whole product-view contract —
 * an incomplete fixture throws into the catch and yields nulls that mimic the bug. */
vi.mock('@/lib/player-data/serializeUnifiedPlayerForApi', () => ({
  serializeUnifiedPlayerForApi: (row: Record<string, unknown>) => row,
}))

import { materializeRedraftRosterPlayersForLeague } from '@/lib/league-runtime/materializeRedraftRosterPlayers'

beforeEach(() => {
  vi.resetAllMocks()
  h.reconcile.mockResolvedValue({ linked: 0, unlinked: 0, alreadyLinked: 0 })
  h.rrpFindMany.mockResolvedValue([])
  h.rrpCreate.mockResolvedValue({})
  h.normalized.mockResolvedValue([])
})

const roster = (over: Record<string, unknown> = {}) => ({
  id: 'roster-a',
  platformUserId: 'user-a',
  redraftRosterId: 'rr-a',
  playerData: { players: ['p1', 'p2'], starters: ['p1'], lineup_sections: { starters: ['p1'], bench: ['p2'] } },
  ...over,
})

describe('the projection', () => {
  it('creates a row per player the redraft roster is missing', async () => {
    h.rosterFindMany.mockResolvedValue([roster()])
    h.normalized.mockResolvedValue([
      { id: 'p1', name: 'Perry Vance', position: 'WR', team: 'GB', sport: 'NFL', byeWeek: 10, injuryStatus: null },
      { id: 'p2', name: 'Dana Okoye', position: 'LB', team: 'CHI', sport: 'NFL', byeWeek: 7, injuryStatus: 'Q' },
    ])

    const out = await materializeRedraftRosterPlayersForLeague('L1')

    expect(out.playersCreated).toBe(2)
    expect(out.rostersLinked).toBe(1)
    expect(h.rrpCreate).toHaveBeenCalledTimes(2)
    expect(h.rrpCreate.mock.calls[0][0].data).toMatchObject({
      rosterId: 'rr-a', playerId: 'p1', playerName: 'Perry Vance', team: 'GB', byeWeek: 10,
      acquisitionType: 'imported',
    })
  })

  it("🛑 a starter's slot is their POSITION, matching what is already in the column", async () => {
    /*
     * Confirmed against production, where WR/RB/QB/TE/DEF/K all appear as slotType values beside
     * bench/taxi/ir. `normalizeSlotType` in the draft path does the same. Writing the literal
     * "starter" here would split one column between two vocabularies.
     */
    h.rosterFindMany.mockResolvedValue([roster()])
    h.normalized.mockResolvedValue([
      { id: 'p1', name: 'Perry Vance', position: 'WR', sport: 'NFL' },
      { id: 'p2', name: 'Dana Okoye', position: 'LB', sport: 'NFL' },
    ])

    await materializeRedraftRosterPlayersForLeague('L1')
    const slots = h.rrpCreate.mock.calls.map((c) => c[0].data.slotType)
    expect(slots).toEqual(['WR', 'bench'])
  })

  it('maps ir and taxi from the top-level arrays when no section names them', async () => {
    h.rosterFindMany.mockResolvedValue([
      roster({ playerData: { players: ['p1', 'p2'], reserve: ['p1'], taxi: ['p2'] } }),
    ])
    await materializeRedraftRosterPlayersForLeague('L1')
    expect(h.rrpCreate.mock.calls.map((c) => c[0].data.slotType)).toEqual(['ir', 'taxi'])
  })

  it('🛑 writes the player even when enrichment fails entirely', async () => {
    /*
     * A provider outage must not keep a roster empty. An unknown position is a worse profile than a
     * known one and a far better one than a missing player — failing the roster would keep the 97%
     * at 97% for the sake of tidier rows.
     */
    h.rosterFindMany.mockResolvedValue([roster({ playerData: { players: ['p1'] } })])
    h.normalized.mockRejectedValue(new Error('provider down'))

    const out = await materializeRedraftRosterPlayersForLeague('L1')

    expect(out.playersCreated).toBe(1)
    expect(h.rrpCreate.mock.calls[0][0].data).toMatchObject({
      playerId: 'p1', playerName: 'p1', position: 'UNK', slotType: 'bench',
    })
  })
})

describe('🛑 what it refuses to do', () => {
  it('skips and REPORTS a roster with no link rather than writing nowhere', async () => {
    h.rosterFindMany.mockResolvedValue([roster({ redraftRosterId: null })])
    const out = await materializeRedraftRosterPlayersForLeague('L1')
    expect(out).toMatchObject({ rostersSkippedNoLink: 1, rostersLinked: 0, playersCreated: 0 })
    expect(h.rrpCreate).not.toHaveBeenCalled()
  })

  it('skips and reports a genuinely empty roster', async () => {
    h.rosterFindMany.mockResolvedValue([roster({ playerData: { players: [] } })])
    const out = await materializeRedraftRosterPlayersForLeague('L1')
    expect(out).toMatchObject({ rostersSkippedNoPlayers: 1, playersCreated: 0 })
  })

  it('🛑 never re-creates a player the redraft engines already own', async () => {
    /*
     * Create-only, deliberately. `Roster.playerData` can be stale — a player traded or waived
     * through a redraft engine may still sit in it — and resurrecting him would make the generic
     * roster silently override the engine that owns the roster now. A two-way sync between two
     * roster stores is the bug this codebase already has twice.
     */
    h.rosterFindMany.mockResolvedValue([roster()])
    h.rrpFindMany.mockResolvedValue([{ playerId: 'p1' }])

    const out = await materializeRedraftRosterPlayersForLeague('L1')

    expect(out.playersAlreadyPresent).toBe(1)
    expect(out.playersCreated).toBe(1)
    expect(h.rrpCreate.mock.calls.map((c) => c[0].data.playerId)).toEqual(['p2'])
  })

  it('reconciles links first, since there is nowhere to write without them', async () => {
    h.rosterFindMany.mockResolvedValue([])
    await materializeRedraftRosterPlayersForLeague('L1')
    expect(h.reconcile).toHaveBeenCalledWith('L1')
  })

  it('does nothing on a league with no rosters', async () => {
    h.rosterFindMany.mockResolvedValue([])
    const out = await materializeRedraftRosterPlayersForLeague('L1')
    expect(out.rostersConsidered).toBe(0)
    expect(h.rrpCreate).not.toHaveBeenCalled()
  })
})
