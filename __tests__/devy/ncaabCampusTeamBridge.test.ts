import { describe, expect, it, vi } from 'vitest'
import { bridgeNcaabCampusTeams, bridgeRiNcaabTeams } from '@/lib/redraft/ncaabCampusTeamBridge'

describe('college basketball school crosswalk', () => {
  it('matches ESPN and RI IDs through the same canonical team', async () => {
    const findMany = vi.fn().mockResolvedValueOnce([{ providerTeamId: '204', teamId: 'school-a' }]).mockResolvedValueOnce([{ providerTeamId: '251', teamId: 'school-a' }])
    const result = await bridgeNcaabCampusTeams({ teamProviderIdentity: { findMany } } as any, ['204'])
    expect([...result.resolved]).toEqual([['204', '251']])
    expect(result.unresolved).toEqual([])
  })
  it('also maps a schedule school back to exactly one ESPN ID', async () => {
    const findMany = vi.fn().mockResolvedValueOnce([{ providerTeamId: '251', teamId: 'school-a' }]).mockResolvedValueOnce([{ providerTeamId: '204', teamId: 'school-a' }])
    const result = await bridgeRiNcaabTeams({ teamProviderIdentity: { findMany } } as any, ['251'])
    expect([...result.resolved]).toEqual([['251', '204']])
  })
  it('refuses missing and conflicting mappings', async () => {
    const findMany = vi.fn().mockResolvedValueOnce([{ providerTeamId: '1', teamId: 'a' }, { providerTeamId: '2', teamId: 'a' }, { providerTeamId: '3', teamId: 'b' }]).mockResolvedValueOnce([{ providerTeamId: '10', teamId: 'a' }, { providerTeamId: '20', teamId: 'b' }, { providerTeamId: '21', teamId: 'b' }])
    const result = await bridgeNcaabCampusTeams({ teamProviderIdentity: { findMany } } as any, ['1', '2', '3', '4'])
    expect(result.resolved.size).toBe(0)
    expect(result.unresolved.sort()).toEqual(['1', '2', '3', '4'])
  })
})
