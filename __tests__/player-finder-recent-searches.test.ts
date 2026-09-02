import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * "Recently searched", per account — and the promise that it never fails a
 * page: before the migration lands it raises P2021, on a locked row it can
 * throw, and both must read as "no recent searches".
 */

const mockUpsert = vi.hoisted(() => vi.fn())
const mockFindMany = vi.hoisted(() => vi.fn())
const mockDeleteMany = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    recentPlayerSearch: { upsert: mockUpsert, findMany: mockFindMany, deleteMany: mockDeleteMany },
  },
}))

import { listRecentPlayerSearches, recordRecentPlayerSearch } from '@/lib/core-app/recentPlayerSearches'

const KINCAID = { sport: 'NFL', externalId: 'ri-1', sleeperId: '10236', name: 'Dalton Kincaid', position: 'TE', team: 'BUF' }

beforeEach(() => {
  mockUpsert.mockReset().mockResolvedValue({})
  mockFindMany.mockReset().mockResolvedValue([])
  mockDeleteMany.mockReset().mockResolvedValue({ count: 0 })
})

describe('recordRecentPlayerSearch', () => {
  it('upserts on (user, sport, player) and bumps the timestamp on a repeat view', async () => {
    await recordRecentPlayerSearch('me', KINCAID)
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const arg = mockUpsert.mock.calls[0][0]
    expect(arg.where).toEqual({ userId_sport_externalId: { userId: 'me', sport: 'NFL', externalId: 'ri-1' } })
    expect(arg.create).toMatchObject({ userId: 'me', name: 'Dalton Kincaid', team: 'BUF' })
    expect(arg.update.searchedAt).toBeInstanceOf(Date)
  })

  it('prunes beyond the cap', async () => {
    mockFindMany.mockResolvedValue([{ id: 'old-1' }, { id: 'old-2' }])
    await recordRecentPlayerSearch('me', KINCAID)
    expect(mockFindMany.mock.calls[0][0]).toMatchObject({ where: { userId: 'me' }, skip: 20 })
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['old-1', 'old-2'] } } })
  })

  /* ⚠ THE WHOLE POINT: a missing table (P2021) is silence, not a 500. */
  it('never throws — a missing table before the migration is silence', async () => {
    mockUpsert.mockRejectedValue(Object.assign(new Error('table does not exist'), { code: 'P2021' }))
    await expect(recordRecentPlayerSearch('me', KINCAID)).resolves.toBeUndefined()
  })

  it('writes nothing without a user or a player key', async () => {
    await recordRecentPlayerSearch('', KINCAID)
    await recordRecentPlayerSearch('me', { ...KINCAID, externalId: '' })
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})

describe('listRecentPlayerSearches', () => {
  const rows = [
    { sport: 'NFL', externalId: 'ri-1', sleeperId: '10236', name: 'Dalton Kincaid', position: 'TE', team: 'BUF', searchedAt: new Date() },
    { sport: 'NFL', externalId: 'ri-2', sleeperId: '1', name: 'Jake Ferguson', position: 'TE', team: 'DAL', searchedAt: new Date() },
    { sport: 'NFL', externalId: 'ri-3', sleeperId: '2', name: 'Isaiah Likely', position: 'TE', team: 'BAL', searchedAt: new Date() },
  ]

  it('returns newest first, excluding the player on screen, capped at the limit', async () => {
    mockFindMany.mockResolvedValue(rows)
    const got = await listRecentPlayerSearches('me', { limit: 2, exclude: { sport: 'NFL', externalId: 'ri-1' } })
    expect(got.map((r) => r.name)).toEqual(['Jake Ferguson', 'Isaiah Likely'])
    // limit + 1 is asked for, so the exclusion cannot leave the list one short.
    expect(mockFindMany.mock.calls[0][0]).toMatchObject({ take: 3, orderBy: { searchedAt: 'desc' } })
  })

  it('reads as empty when the table is missing or the user is unknown', async () => {
    mockFindMany.mockRejectedValue(new Error('P2021'))
    expect(await listRecentPlayerSearches('me')).toEqual([])
    expect(await listRecentPlayerSearches('')).toEqual([])
  })
})
