// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ links: vi.fn(), leagues: vi.fn(), snapshots: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { franchiseLink: { findMany: mocks.links }, league: { findMany: mocks.leagues }, fantraxLeague: { findMany: mocks.snapshots } } }))
import { attachLeagueHubs } from '@/lib/core-app/attachLeagueHubs'
import type { LeagueHub } from '@/lib/core-app/leagueHubGroups'
describe('shared league membership resolution', () => {
  it('maps Fantrax provider and snapshot IDs to the same hub while respecting platforms and ownership', async () => {
    mocks.links.mockResolvedValue([{ id: 'hub', name: 'Bowl', members: [{ platform: 'fantrax', leagueId: 'provider' }, { platform: 'sleeper', leagueId: 'pro' }] }])
    mocks.leagues.mockResolvedValue([{ id: 'cream', platform: 'fantrax', platformLeagueId: 'snapshot' }, { id: 'pro', platform: 'sleeper', platformLeagueId: 'sleeper-id' }])
    mocks.snapshots.mockResolvedValue([{ id: 'snapshot', sourceLeagueId: 'provider' }])
    const rows: Array<{id:string;name:string;platform:string;hub?:LeagueHub}> = [{ id: 'cream', name: 'Cream', platform: 'fantrax' }, { id: 'pro', name: 'Peach', platform: 'sleeper' }, { id: 'provider', name: 'Other', platform: 'espn' }]
    await attachLeagueHubs('owner', rows)
    expect(rows[0].hub).toBe(rows[1].hub)
    expect(rows[0].hub?.members).toHaveLength(2)
    expect(rows[2].hub).toBeUndefined()
    expect(mocks.links).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerUserId: 'owner' } }))
    expect(mocks.snapshots).toHaveBeenCalledWith(expect.objectContaining({ where: { appUserId: 'owner' } }))
  })
})
