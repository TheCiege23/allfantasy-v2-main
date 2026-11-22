import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * "Unknown" team headers on every mirrored KBI draft board (2026-11-17).
 *
 * The saved draft order seated 16 roster ids that a re-import had deleted, every name was the
 * literal "Unknown", and nothing repaired it because the completeness check only counts slots.
 * The Sleeper mirror also refused to touch it ("never overwrite a local order") and, when it did
 * write an order, wrote Sleeper's own 1..N roster numbers, which match no roster here either.
 */

const h = vi.hoisted(() => ({
  prisma: {
    draftSession: {
      update: vi.fn(async () => ({ id: 'sess-1', leagueId: 'lg-1', status: 'paused' })),
      findUnique: vi.fn(async (): Promise<Record<string, unknown>> => ({ leagueId: 'lg-1', slotOrder: [] })),
    },
    roster: { findMany: vi.fn(async (): Promise<unknown[]> => []) },
    draftPick: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(h.prisma)),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))

import {
  buildSleeperTeamNumberToRosterIdMap,
  buildSleeperUserToRosterIdMap,
  rosterImportedName,
  slotOrderFromMirroredPicks,
  slotOrderHasMissingRosters,
} from '@/lib/draft/sleeperMirrorRosterIds'
import { syncDraftFromSleeper } from '@/lib/draft/sleeperSync'

/** A roster exactly as a Sleeper import stores it (shape read from production rows). */
function roster(id: string, sleeperUser: string, teamNumber: number, name: string, platformUserId = sleeperUser) {
  return {
    id,
    platformUserId,
    playerData: {
      source_manager_id: sleeperUser,
      source_team_id: String(teamNumber),
      import: { provider: 'sleeper', displayName: name, ownerName: name, sourceTeamId: String(teamNumber), sourceManagerId: sleeperUser },
    },
  }
}

const ROSTERS = [
  roster('r-alice', 'u_alice', 1, 'Alice'),
  // Claimed on AllFantasy: platformUserId is now the AF user id, the Sleeper id lives in playerData.
  roster('r-bob', 'u_bob', 2, 'Bob', 'af-user-bob'),
]

describe('slotOrderHasMissingRosters', () => {
  const live = new Set(['r-alice', 'r-bob'])
  it('flags an order seating a deleted roster', () => {
    expect(slotOrderHasMissingRosters([{ slot: 1, rosterId: 'dead-uuid' }, { slot: 2, rosterId: 'r-bob' }], live)).toBe(true)
  })
  it('passes an order of live rosters, and never counts placeholder seats', () => {
    expect(slotOrderHasMissingRosters([{ slot: 1, rosterId: 'r-alice' }, { slot: 2, rosterId: 'placeholder-2' }], live)).toBe(false)
  })
  it('cannot judge anything without rosters', () => {
    expect(slotOrderHasMissingRosters([{ slot: 1, rosterId: 'dead-uuid' }], new Set())).toBe(false)
  })
})

describe('buildSleeperTeamNumberToRosterIdMap', () => {
  it('maps Sleeper roster numbers to our roster ids, dropping a number two rosters claim', () => {
    const map = buildSleeperTeamNumberToRosterIdMap([...ROSTERS, roster('r-dupe', 'u_x', 2, 'X')])
    expect(map.get('1')).toBe('r-alice')
    expect(map.has('2')).toBe(false)
  })
  it('reads the imported manager name', () => {
    expect(rosterImportedName(ROSTERS[1])).toBe('Bob')
  })
})

describe('slotOrderFromMirroredPicks', () => {
  const userMap = buildSleeperUserToRosterIdMap(ROSTERS)
  const names = (id: string) => rosterImportedName(ROSTERS.find((r) => r.id === id)!)
  const pick = (slot: number, user: string, source = 'sleeper-mirror') => ({ slot, rosterId: user, source, displayName: null })

  it('seats every column by the manager who made its picks, including a claimed roster', () => {
    const out = slotOrderFromMirroredPicks({
      teamCount: 2,
      picks: [pick(1, 'u_alice'), pick(2, 'u_bob'), pick(2, 'u_bob'), pick(1, 'u_alice')],
      sleeperUserToRosterId: userMap,
      nameForRoster: names,
    })
    expect(out).toEqual([
      { slot: 1, rosterId: 'r-alice', displayName: 'Alice' },
      { slot: 2, rosterId: 'r-bob', displayName: 'Bob' },
    ])
  })

  it('a traded pick in the minority does not move a seat', () => {
    const out = slotOrderFromMirroredPicks({
      teamCount: 2,
      picks: [pick(1, 'u_alice'), pick(1, 'u_alice'), pick(1, 'u_bob'), pick(2, 'u_bob')],
      sleeperUserToRosterId: userMap,
      nameForRoster: names,
    })
    expect(out?.map((e) => e.rosterId)).toEqual(['r-alice', 'r-bob'])
  })

  it('answers null rather than a partial order', () => {
    // Slot 2 has no picks yet.
    expect(slotOrderFromMirroredPicks({ teamCount: 2, picks: [pick(1, 'u_alice')], sleeperUserToRosterId: userMap, nameForRoster: names })).toBeNull()
    // Two columns resolving to one roster.
    expect(
      slotOrderFromMirroredPicks({ teamCount: 2, picks: [pick(1, 'u_alice'), pick(2, 'u_alice')], sleeperUserToRosterId: userMap, nameForRoster: names }),
    ).toBeNull()
    // A tie is not a majority.
    expect(
      slotOrderFromMirroredPicks({
        teamCount: 2,
        picks: [pick(1, 'u_alice'), pick(1, 'u_bob'), pick(2, 'u_bob')],
        sleeperUserToRosterId: userMap,
        nameForRoster: names,
      }),
    ).toBeNull()
  })

  it('ignores picks made in AllFantasy', () => {
    expect(
      slotOrderFromMirroredPicks({
        teamCount: 2,
        picks: [pick(1, 'u_alice', 'manual'), pick(2, 'u_bob')],
        sleeperUserToRosterId: userMap,
        nameForRoster: names,
      }),
    ).toBeNull()
  })
})

describe('syncDraftFromSleeper seats the order by our roster ids', () => {
  const DRAFT = {
    draft_id: 'd1',
    league_id: 'L1',
    status: 'paused',
    settings: { rounds: 3, teams: 2, pick_timer: 90 },
    draft_order: { u_alice: 2, u_bob: 1 },
    slot_to_roster_id: { '1': 2, '2': 1 },
  }

  function mockSleeper() {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = String(input)
      const body = url.endsWith('/picks')
        ? []
        : url.includes('/league/')
          ? [
              { user_id: 'u_alice', display_name: 'Alice' },
              { user_id: 'u_bob', display_name: 'Bob' },
            ]
          : DRAFT
      return { ok: true, status: 200, json: async () => body } as unknown as Response
    })
  }

  const data = () => h.prisma.draftSession.update.mock.calls[0]![0]!.data as Record<string, unknown>

  beforeEach(() => {
    vi.restoreAllMocks()
    h.prisma.draftSession.update.mockClear()
    h.prisma.roster.findMany.mockReset()
    h.prisma.roster.findMany.mockImplementation(async () => ROSTERS)
    h.prisma.draftSession.findUnique.mockReset()
  })

  const SEATED = [
    { slot: 1, rosterId: 'r-bob', displayName: 'Bob' },
    { slot: 2, rosterId: 'r-alice', displayName: 'Alice' },
  ]

  it('writes Roster.ids, not Sleeper roster numbers, into an empty order', async () => {
    h.prisma.draftSession.findUnique.mockImplementation(async () => ({ leagueId: 'lg-1', slotOrder: [] }))
    mockSleeper()
    await syncDraftFromSleeper('d1', 'sess-1')
    expect(data().slotOrder).toEqual(SEATED)
  })

  it('replaces an order seating deleted rosters (the KBI "Unknown" headers)', async () => {
    h.prisma.draftSession.findUnique.mockImplementation(async () => ({
      leagueId: 'lg-1',
      slotOrder: [
        { slot: 1, rosterId: 'dead-1', displayName: 'Unknown' },
        { slot: 2, rosterId: 'dead-2', displayName: 'Unknown' },
      ],
    }))
    mockSleeper()
    await syncDraftFromSleeper('d1', 'sess-1')
    expect(data().slotOrder).toEqual(SEATED)
  })

  it('still never overwrites a live local order (a lottery or commissioner result)', async () => {
    const local = [
      { slot: 1, rosterId: 'r-alice', displayName: 'Alice' },
      { slot: 2, rosterId: 'r-bob', displayName: 'Bob' },
    ]
    h.prisma.draftSession.findUnique.mockImplementation(async () => ({ leagueId: 'lg-1', slotOrder: local }))
    mockSleeper()
    await syncDraftFromSleeper('d1', 'sess-1')
    expect(data()).not.toHaveProperty('slotOrder')
  })

  it('does not replace a dead order with one it cannot seat either', async () => {
    h.prisma.roster.findMany.mockImplementation(async () => [roster('r-carol', 'u_carol', 9, 'Carol')])
    h.prisma.draftSession.findUnique.mockImplementation(async () => ({
      leagueId: 'lg-1',
      slotOrder: [
        { slot: 1, rosterId: 'dead-1', displayName: 'Unknown' },
        { slot: 2, rosterId: 'dead-2', displayName: 'Unknown' },
      ],
    }))
    mockSleeper()
    await syncDraftFromSleeper('d1', 'sess-1')
    expect(data()).not.toHaveProperty('slotOrder')
  })
})
