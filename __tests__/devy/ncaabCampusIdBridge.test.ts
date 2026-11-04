import { describe, expect, it, vi } from 'vitest'
import { bridgeNcaabCampusIds } from '@/lib/redraft/ncaabCampusIdBridge'

describe('college basketball campus ID bridge', () => {
  it('uses the ESPN ID within NCAAB and returns missing mappings explicitly', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'identity-1', espnId: '12' }])
    const result = await bridgeNcaabCampusIds({ playerIdentityMap: { findMany } }, ['espn:ncaab:12', 'espn:ncaab:13', '12'])
    expect(findMany).toHaveBeenCalledWith({ where: { sport: 'NCAAB', espnId: { in: ['12', '13'] } }, select: { id: true, espnId: true } })
    expect([...result.resolved]).toEqual([['espn:ncaab:12', 'identity-1']])
    expect(result.missing).toEqual(['espn:ncaab:13', '12'])
  })
  it('refuses duplicate identities and shared game logs', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'a', espnId: '1' }, { id: 'b', espnId: '1' }, { id: 'c', espnId: '2' }, { id: 'c', espnId: '3' }])
    const result = await bridgeNcaabCampusIds({ playerIdentityMap: { findMany } }, ['espn:ncaab:1', 'espn:ncaab:2', 'espn:ncaab:3'])
    expect(result.resolved.size).toBe(0)
    expect(result.ambiguous).toEqual(['espn:ncaab:1', 'espn:ncaab:2', 'espn:ncaab:3'])
  })
  it('does not query or infer identity from malformed IDs', async () => {
    const findMany = vi.fn()
    const result = await bridgeNcaabCampusIds({ playerIdentityMap: { findMany } }, ['espn:ncaab:bad'])
    expect(findMany).not.toHaveBeenCalled()
    expect(result.missing).toEqual(['espn:ncaab:bad'])
  })
})
