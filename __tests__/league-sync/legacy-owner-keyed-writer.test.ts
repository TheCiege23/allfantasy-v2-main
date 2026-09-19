/**
 * The legacy per-league sync (`/api/league/sync` → `syncLeague`), which is NOT dead.
 *
 * 🛑 WHY THIS SUITE EXISTS. `components/core-app/AfCoreShell.tsx` says "nothing in the UI calls
 * them now". That is true of `/api/league/sleeper-sync` and false of this one: `app/legacy/page.tsx`
 * mounts `<WaiverAI>`, whose sync button POSTs `/api/league/sync`. So a signed-in user can still
 * reach this writer, and it had two faults the modern stack has already paid for elsewhere:
 *
 *  1. It upserted on `leagueId_platformUserId`. Sleeper sends `owner_id` — a MANAGER — so a team
 *     that changes hands gets a SECOND row and the first is never looked at again. That is the
 *     ghost-row shape `importedRosterIdentity.ts` exists to prevent; 33 were deleted from
 *     production on 2026-09-17, and `lib/trade-intel/tradeContextNotes.ts` documents this route
 *     creating them ("newest write wins" is its workaround).
 *  2. It wrote `playerData` as a BARE ARRAY over whatever was there. Every modern writer stores an
 *     object — players, starters, reserve, taxi, source_team_id, the import record — so one press
 *     of that button stripped a roster of its lineup and of the id that ties it to its team.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagueUpsert: vi.fn(),
  leagueFindFirst: vi.fn(),
  rosterFindMany: vi.fn(),
  rosterFindUnique: vi.fn(),
  rosterUpdate: vi.fn(),
  rosterUpsert: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { upsert: h.leagueUpsert, findFirst: h.leagueFindFirst },
    roster: {
      findMany: h.rosterFindMany,
      findUnique: h.rosterFindUnique,
      update: h.rosterUpdate,
      upsert: h.rosterUpsert,
    },
  },
}))
vi.mock('@/lib/league-delete/leagueTombstones', () => ({
  isLeagueTombstoned: async () => false,
  LeagueDeletedByUserError: class extends Error {},
}))
vi.mock('@/lib/league/afOwnedLeagueSettings', () => ({
  carryAfOwnedLeagueSettings: (_current: unknown, next: unknown) => next,
}))

import { mergeLegacyPlayerData, syncLeague } from '@/lib/league-sync-core'

/** One Sleeper team, roster_id 7, currently managed by NEW_MANAGER. */
const OLD_MANAGER = '111111111111111111'
const NEW_MANAGER = '222222222222222222'

const sleeperResponses = (rosters: unknown[]) => (url: string) => {
  if (url.endsWith('/rosters')) return { ok: true, json: async () => rosters }
  return {
    ok: true,
    json: async () => ({ name: 'A League', total_rosters: 12, season: '2026', settings: {}, scoring_settings: {} }),
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  h.leagueFindFirst.mockResolvedValue(null)
  h.leagueUpsert.mockResolvedValue({ id: 'L1', name: 'A League', scoringType: 'ppr', isDynasty: false })
  h.rosterFindMany.mockResolvedValue([])
  h.rosterFindUnique.mockResolvedValue(null)
  h.rosterUpdate.mockResolvedValue({})
  h.rosterUpsert.mockResolvedValue({})
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      sleeperResponses([
        { roster_id: 7, owner_id: NEW_MANAGER, players: ['4034', '6794'], settings: {} },
      ])(String(url)),
    ),
  )
})

describe('the legacy sync finds the TEAM row, not the manager key', () => {
  it('🛑 updates the row this team already has when the manager has changed', async () => {
    // The stored row is keyed to the manager who has gone, and carries the team id.
    h.rosterFindMany.mockResolvedValue([
      {
        id: 'existing-row',
        playerData: { players: ['old'], starters: ['old'], source_team_id: '7' },
      },
    ])

    await syncLeague('u1', 'sleeper', '999')

    expect(h.rosterUpdate).toHaveBeenCalledTimes(1)
    expect(h.rosterUpdate.mock.calls[0][0].where).toEqual({ id: 'existing-row' })
    // and NOT a second row under the new manager's key
    expect(h.rosterUpsert).not.toHaveBeenCalled()
  })

  it('🛑 keeps every other key of the stored roster, replacing only the player list', async () => {
    h.rosterFindMany.mockResolvedValue([
      {
        id: 'existing-row',
        playerData: {
          players: ['old'],
          starters: ['s1'],
          reserve: ['r1'],
          taxi: [],
          source_team_id: '7',
          import: { sourceManagerId: OLD_MANAGER },
        },
      },
    ])

    await syncLeague('u1', 'sleeper', '999')

    expect(h.rosterUpdate.mock.calls[0][0].data.playerData).toEqual({
      players: ['4034', '6794'],
      starters: ['s1'],
      reserve: ['r1'],
      taxi: [],
      source_team_id: '7',
      import: { sourceManagerId: OLD_MANAGER },
    })
  })

  it('🛑 refuses to choose when two rows carry the same team id', async () => {
    // Two rows for one team is the damage being prevented; picking one would pick a vintage.
    h.rosterFindMany.mockResolvedValue([
      { id: 'a', playerData: { source_team_id: '7' } },
      { id: 'b', playerData: { source_team_id: '7' } },
    ])

    await syncLeague('u1', 'sleeper', '999')

    expect(h.rosterUpdate).not.toHaveBeenCalled()
    // Falls back to the key — the old behaviour, and no worse.
    expect(h.rosterUpsert).toHaveBeenCalledTimes(1)
  })

  it('falls back to the manager key when no stored row carries the team id', async () => {
    h.rosterFindMany.mockResolvedValue([{ id: 'other', playerData: { source_team_id: '9' } }])

    await syncLeague('u1', 'sleeper', '999')

    expect(h.rosterUpsert).toHaveBeenCalledTimes(1)
    expect(h.rosterUpsert.mock.calls[0][0].where).toEqual({
      leagueId_platformUserId: { leagueId: 'L1', platformUserId: NEW_MANAGER },
    })
  })

  it('updates the row found by the manager key when it carries no team id yet', async () => {
    // A row written before this path stamped team ids: matched by key, still updated in place.
    h.rosterFindMany.mockResolvedValue([
      { id: 'legacy-row', platformUserId: NEW_MANAGER, playerData: ['old'] },
    ])

    await syncLeague('u1', 'sleeper', '999')

    expect(h.rosterUpdate).toHaveBeenCalledTimes(1)
    expect(h.rosterUpdate.mock.calls[0][0].where).toEqual({ id: 'legacy-row' })
    expect(h.rosterUpsert).not.toHaveBeenCalled()
  })

  it('carries the Sleeper roster_id as the team id', async () => {
    // Without this the lookup above has nothing to match on and every team falls back to the key.
    h.rosterFindMany.mockResolvedValue([
      { id: 'existing-row', playerData: { source_team_id: '7' } },
    ])
    await syncLeague('u1', 'sleeper', '999')
    expect(h.rosterUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('mergeLegacyPlayerData', () => {
  it('🛑 never lets a bare array replace the object the rest of the app reads', () => {
    const stored = { players: ['a'], starters: ['a'], source_team_id: '7' }
    expect(mergeLegacyPlayerData(stored, ['b', 'c'])).toEqual({
      players: ['b', 'c'],
      starters: ['a'],
      source_team_id: '7',
    })
  })

  it('takes the list when there is nothing stored', () => {
    expect(mergeLegacyPlayerData(null, ['b'])).toEqual(['b'])
    expect(mergeLegacyPlayerData(undefined, ['b'])).toEqual(['b'])
  })

  it('takes the list when the stored value is itself a bare array', () => {
    expect(mergeLegacyPlayerData(['a'], ['b'])).toEqual(['b'])
  })

  it('does not mutate the stored object', () => {
    const stored = { players: ['a'], starters: ['a'] }
    mergeLegacyPlayerData(stored, ['b'])
    expect(stored.players).toEqual(['a'])
  })
})
