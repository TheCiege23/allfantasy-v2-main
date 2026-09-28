/**
 * The one attribution rule for `decision_os_imported_activity`: who made a move, and which rows belong
 * to a league. Player Finder presence and commissioner review both read it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const profiles = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: { userProfile: { findMany: profiles } } }))

import { importedActivityLeagueWhere, managerKeysOf, teamResolver } from '@/lib/core-app/importedActivityAttribution'

const teams = [
  { externalId: '3', platformUserId: 'sl-100', claimedByUserId: 'af-user-1' },
  { externalId: '7', platformUserId: 'sl-200', claimedByUserId: null },
  { externalId: '9', platformUserId: null, claimedByUserId: null },
]

beforeEach(() => {
  profiles.mockReset()
  profiles.mockResolvedValue([])
})

describe('importedActivityLeagueWhere', () => {
  it("matches this row's own id, and a sibling importer's rows by provider AND provider league id", () => {
    expect(importedActivityLeagueWhere({ id: 'L1', platform: 'Sleeper', platformLeagueId: '1314' })).toEqual({
      OR: [{ afLeagueId: 'L1' }, { provider: 'sleeper', providerLeagueId: '1314' }],
    })
  })

  it('a native league has no provider arm — a bare id would match any provider', () => {
    expect(importedActivityLeagueWhere({ id: 'L1', platform: 'native', platformLeagueId: null })).toEqual({ OR: [{ afLeagueId: 'L1' }] })
  })
})

describe('teamResolver', () => {
  it('resolves every spelling a manager key is written in', () => {
    const { resolve } = teamResolver(teams)
    for (const k of ['sl-100', 'sleeper:sl-100', 'sleeper:manager:sl-100', 'af-user-1']) expect(resolve(k)?.externalId).toBe('3')
    expect(resolve('yahoo:manager:sl-200')?.externalId).toBe('7') // any provider prefix, by its tail
    expect(resolve('nobody')).toBeUndefined()
  })

  it("places an unclaimed manager's AF user id through their linked Sleeper id — one read, only for the unresolved", async () => {
    profiles.mockResolvedValue([{ userId: 'af-user-2', sleeperUserId: 'sl-200' }])
    const r = teamResolver(teams)
    await r.withProfileKeys(['sl-100', 'af-user-2', 'af-user-2'])
    expect(profiles).toHaveBeenCalledTimes(1)
    expect(profiles.mock.calls[0]![0].where.userId.in).toEqual(['af-user-2'])
    expect(r.resolve('af-user-2')?.externalId).toBe('7')
  })

  it('reads nothing when every key already resolves', async () => {
    await teamResolver(teams).withProfileKeys(['sl-100', 'sleeper:sl-200'])
    expect(profiles).not.toHaveBeenCalled()
  })
})

describe('managerKeysOf', () => {
  it('reads normalized.managerKeys and nothing else', () => {
    expect(managerKeysOf({ managerKeys: ['a', 2, '', null] })).toEqual(['a', '2'])
    expect(managerKeysOf(null)).toEqual([])
    expect(managerKeysOf({ managerKeys: 'a' })).toEqual([])
  })
})
