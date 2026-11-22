import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { fantraxLeague: { findUnique: h.findUnique, findMany: h.findMany } } }))

import { equivalentPlatformLeagueIds, platformLeagueIdWhere } from '@/lib/league-import/samePlatformLeague'

beforeEach(() => {
  h.findUnique.mockReset()
  h.findMany.mockReset()
})

describe('the same provider league under every id it is stored by', () => {
  it('any provider but Fantrax: the id itself, and the database is not asked', async () => {
    expect(await equivalentPlatformLeagueIds('sleeper', '1359284500814647296')).toEqual(['1359284500814647296'])
    expect(await platformLeagueIdWhere('espn', '123')).toBe('123')
    expect(h.findUnique).not.toHaveBeenCalled()
  })

  it('🛑 Fantrax: snapshots sharing the real Fantrax league id, in the same season, are one league', async () => {
    // Production 2026-11-22: one 180-team league, six copies, three accounts, six different ids.
    h.findUnique.mockResolvedValue({ sourceLeagueId: '7qkhjoyomt7op56k', season: 2026 })
    h.findMany.mockResolvedValue([{ id: 'snap-tommy' }, { id: 'snap-warpirate' }, { id: 'snap-mine' }])
    expect(await equivalentPlatformLeagueIds('fantrax', 'snap-mine')).toEqual(['snap-mine', 'snap-tommy', 'snap-warpirate'])
    expect(h.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { sourceLeagueId: '7qkhjoyomt7op56k', season: 2026 } }))
    expect(await platformLeagueIdWhere('fantrax', 'snap-mine')).toEqual({ in: ['snap-mine', 'snap-tommy', 'snap-warpirate'] })
  })

  it('a Fantrax league imported once keeps the plain id', async () => {
    h.findUnique.mockResolvedValue({ sourceLeagueId: 'abc', season: 2026 })
    h.findMany.mockResolvedValue([{ id: 'only' }])
    expect(await platformLeagueIdWhere('fantrax', 'only')).toBe('only')
  })

  it('a CSV-era snapshot with no Fantrax id matches nothing but itself', async () => {
    h.findUnique.mockResolvedValue({ sourceLeagueId: null, season: 2026 })
    expect(await equivalentPlatformLeagueIds('fantrax', 'csv-row')).toEqual(['csv-row'])
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('a failed read costs a duplicate, never a wrong join', async () => {
    h.findUnique.mockRejectedValue(new Error('db down'))
    expect(await equivalentPlatformLeagueIds('fantrax', 'x')).toEqual(['x'])
  })
})
