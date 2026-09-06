import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The typeahead's catalog read: prefix matches with a team first, then prefix
 * matches without one, then the plain contains-match — each read only when
 * the one before ran short, all in NAME order so a player's source rows stay
 * adjacent for the collapse. Measured on production: "kin" through the
 * id-ordered contains-query never reached Dalton Kincaid.
 */

const mockFindMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: { sportsPlayer: { findMany: mockFindMany } } }))

import { suggestCatalog } from '@/lib/core-app/playerFinder'

const row = (externalId: string, name: string, over: Partial<{ sleeperId: string | null; position: string; team: string | null; imageUrl: string | null }> = {}) => ({
  externalId,
  sleeperId: over.sleeperId === undefined ? externalId : over.sleeperId,
  name,
  position: over.position ?? 'TE',
  team: over.team === undefined ? 'BUF' : over.team,
  imageUrl: over.imageUrl ?? null,
  number: null,
  sport: 'NFL',
})

const PREFIX_WHERE = {
  OR: [
    { name: { startsWith: 'kin', mode: 'insensitive' } },
    { name: { contains: ' kin', mode: 'insensitive' } },
  ],
}

beforeEach(() => mockFindMany.mockReset())

describe('suggestCatalog', () => {
  it('reads prefix matches with a team first, in name order, and stops there when they fill the list', async () => {
    mockFindMany.mockResolvedValueOnce([row('1', 'Dalton Kincaid'), row('2', 'Kamren Kinchens'), row('3', 'Kingsley Suamataia')])
    const got = await suggestCatalog('kin', 3)
    expect(got.map((m) => m.name)).toEqual(['Dalton Kincaid', 'Kamren Kinchens', 'Kingsley Suamataia'])
    expect(mockFindMany).toHaveBeenCalledTimes(1)
    const call = mockFindMany.mock.calls[0][0]
    expect(call.where).toEqual({ ...PREFIX_WHERE, team: { not: null } })
    expect(call.orderBy[0]).toEqual({ name: 'asc' })
    expect(call.take).toBe(200)
  })

  /* The pass that makes three letters work: rostered players are read before the alphabet. */
  it('reads the rostered prefix matches first when told who is rostered, then the rest', async () => {
    mockFindMany
      .mockResolvedValueOnce([row('10236', 'Dalton Kincaid')])
      .mockResolvedValueOnce([row('1', 'AJ King', { position: 'QB', team: 'DAL' }), row('10236', 'Dalton Kincaid'), row('2', 'Adrian King', { position: 'DB', team: 'ATL' })])
      .mockResolvedValue([])
    const got = await suggestCatalog('kin', 3, { preferIds: ['10236', '77'] })
    expect(got.map((m) => m.name)).toEqual(['Dalton Kincaid', 'AJ King', 'Adrian King'])
    expect(mockFindMany.mock.calls[0][0].where).toEqual({ ...PREFIX_WHERE, sleeperId: { in: ['10236', '77'] } })
    expect(mockFindMany.mock.calls[1][0].where).toEqual({ ...PREFIX_WHERE, team: { not: null } })
  })

  it('tops up from teamless prefix matches, then the contains-match, without repeating anyone', async () => {
    mockFindMany
      .mockResolvedValueOnce([row('1', 'Dalton Kincaid')])
      .mockResolvedValueOnce([row('5', 'Brandon King', { team: null })])
      .mockResolvedValueOnce([row('1', 'Dalton Kincaid'), row('9', 'Andrew Hawkins', { position: 'WR', team: 'CLE' }), row('8', 'Tyler Skinner', { position: 'WR', team: 'DEN' })])
    const got = await suggestCatalog('kin', 3)
    expect(got.map((m) => m.name)).toEqual(['Dalton Kincaid', 'Brandon King', 'Andrew Hawkins'])
    expect(mockFindMany).toHaveBeenCalledTimes(3)
    expect(mockFindMany.mock.calls[1][0].where).toEqual({ ...PREFIX_WHERE, team: null })
    expect(mockFindMany.mock.calls[2][0].where).toEqual({ name: { contains: 'kin', mode: 'insensitive' } })
  })

  it('folds duplicate source rows the same way the page search does', async () => {
    mockFindMany
      .mockResolvedValueOnce([
        row('sleeper:10236', 'Dalton Kincaid'),
        row('tsdb_1', 'Dalton Kincaid', { sleeperId: null, position: 'Tight End', imageUrl: 'https://img/kincaid.png' }),
      ])
      .mockResolvedValue([]) // the top-up passes find nothing more
    const got = await suggestCatalog('kinc', 3)
    expect(got).toHaveLength(1)
    expect(mockFindMany).toHaveBeenCalledTimes(3)
    expect(got[0]).toMatchObject({ externalId: 'sleeper:10236', sleeperId: 'sleeper:10236', imageUrl: 'https://img/kincaid.png' })
  })

  it('returns nothing under two characters without asking', async () => {
    expect(await suggestCatalog('k')).toEqual([])
    expect(mockFindMany).not.toHaveBeenCalled()
  })
})
