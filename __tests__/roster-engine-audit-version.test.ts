import { beforeEach, describe, expect, it, vi } from 'vitest'

const leagueFindUniqueMock = vi.fn()
const leagueUpdateMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: leagueFindUniqueMock,
      update: leagueUpdateMock,
    },
  },
}))

describe('roster-engine audit and versioning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('increments version and appends audit entry on update', async () => {
    const service = {
      getConfig: vi
        .fn()
        .mockResolvedValueOnce({
          templateKey: 'custom',
          slots: { QB: 2, RB: 2 },
          isCustom: true,
          lastUpdatedAt: '2026-01-01T00:00:00.000Z',
          lastUpdatedBy: 'u1',
        })
        .mockResolvedValueOnce({
          templateKey: 'custom',
          slots: { QB: 2, RB: 2 },
          isCustom: true,
          lastUpdatedAt: '2026-01-01T00:00:00.000Z',
          lastUpdatedBy: 'u1',
        }),
      saveConfig: vi.fn().mockResolvedValue(undefined),
      applyDefaultOnCreate: vi.fn(),
      getSlots: vi.fn().mockReturnValue([
        { key: 'QB', label: 'Quarterback', shortLabel: 'QB', color: '#fff', category: 'offense', defaultCount: 1, minCount: 0, maxCount: 4 },
        { key: 'RB', label: 'Running Back', shortLabel: 'RB', color: '#fff', category: 'offense', defaultCount: 2, minCount: 0, maxCount: 6 },
      ]),
      getTemplates: vi.fn().mockReturnValue([]),
      resolveDefaultTemplate: vi.fn().mockReturnValue({ key: 'redraft', label: 'Redraft', leagueTypes: ['redraft'], description: 'Default', slots: { QB: 1, RB: 2 } }),
    }

    const registrySpy = vi.spyOn(await import('../lib/roster-engine/RosterEngineRegistry'), 'getRosterEngineRegistry')
      .mockReturnValue({
        getService: vi.fn().mockReturnValue(service),
      } as any)

    vi.spyOn(await import('../lib/roster-engine/RosterPermissionsService'), 'checkCommissionerPermission')
      .mockResolvedValue({ isCommissioner: true, readOnly: false })

    leagueFindUniqueMock
      .mockResolvedValueOnce({
        sport: 'NFL',
        leagueType: 'redraft',
        settings: {
          roster: {
            version: 1,
            auditLog: [
              {
                timestamp: '2026-01-01T00:00:00.000Z',
                userId: 'system',
                action: 'created',
                templateKey: 'redraft',
              },
            ],
          },
        },
      })
      // The re-read after saveConfig: the settings now carry the slots saveConfig just wrote.
      .mockResolvedValueOnce({
        settings: {
          roster: {
            version: 1,
            auditLog: [
              {
                timestamp: '2026-01-01T00:00:00.000Z',
                userId: 'system',
                action: 'created',
                templateKey: 'redraft',
              },
            ],
          },
          nfl_roster_config: { slots: { QB: 2, RB: 2 }, isCustom: true },
        },
      })
      .mockResolvedValueOnce({
        sport: 'NFL',
        leagueType: 'redraft',
        settings: { roster: { version: 2, source: 'CUSTOM' } },
      })

    const { updateLeagueRosterConfig } = await import('../lib/roster-engine/UnifiedRosterConfigService')

    await updateLeagueRosterConfig(
      'league-1',
      { templateKey: 'custom', slots: { QB: 2, RB: 2 } },
      'commissioner-1',
    )

    expect(leagueUpdateMock).toHaveBeenCalledTimes(1)
    const updatePayload = leagueUpdateMock.mock.calls[0]?.[0]?.data?.settings?.roster
    expect(updatePayload.version).toBe(2)
    expect(Array.isArray(updatePayload.auditLog)).toBe(true)
    expect(updatePayload.auditLog).toHaveLength(2)
    expect(updatePayload.auditLog[1]?.action).toBe('updated')
    expect(updatePayload.auditLog[1]?.changedKeys).toContain('QB')
    // The write must keep what saveConfig saved, not restore the settings read before it.
    expect(leagueUpdateMock.mock.calls[0]?.[0]?.data?.settings?.nfl_roster_config).toEqual({ slots: { QB: 2, RB: 2 }, isCustom: true })

    registrySpy.mockRestore()
  })
})
