import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSessionMock = vi.fn()
const checkCommissionerPermissionMock = vi.fn()
const mapImportedRosterToLeagueConfigMock = vi.fn()
const previewImportedRosterForLeagueMock = vi.fn()

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

// The lifecycle gate (lib/league/settingsLifecycleGate.ts) is covered by
// __tests__/settings-editors-lifecycle-gate.test.ts; here it always allows.
vi.mock('@/lib/league/settingsLifecycleGate', () => ({
  settingsLifecycleRefusal: vi.fn(async () => null),
}))

vi.mock('@/lib/roster-engine', () => ({
  checkCommissionerPermission: checkCommissionerPermissionMock,
  mapImportedRosterToLeagueConfig: mapImportedRosterToLeagueConfigMock,
  previewImportedRosterForLeague: previewImportedRosterForLeagueMock,
}))

describe('/api/commissioner/leagues/[leagueId]/roster-settings/import route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u-commissioner' } })
    checkCommissionerPermissionMock.mockResolvedValue({ isCommissioner: true, readOnly: false })
  })

  it('returns 401 for unauthenticated users', async () => {
    getServerSessionMock.mockResolvedValueOnce(null)
    const { POST } = await import('../app/api/commissioner/leagues/[leagueId]/roster-settings/import/route')

    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, {
      params: Promise.resolve({ leagueId: 'l1' }),
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 for non-commissioner users', async () => {
    checkCommissionerPermissionMock.mockResolvedValueOnce({ isCommissioner: false, readOnly: true })
    const { POST } = await import('../app/api/commissioner/leagues/[leagueId]/roster-settings/import/route')

    const res = await POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePlatform: 'yahoo', importedConfig: { QB: 1 } }),
      }) as any,
      { params: Promise.resolve({ leagueId: 'l1' }) },
    )

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Commissioner only' })
  })

  it('returns 400 when sourcePlatform is missing', async () => {
    const { POST } = await import('../app/api/commissioner/leagues/[leagueId]/roster-settings/import/route')

    const res = await POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importedConfig: { QB: 1 } }),
      }) as any,
      { params: Promise.resolve({ leagueId: 'l1' }) },
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'sourcePlatform required' })
  })

  it('returns preview mapping payload by default', async () => {
    previewImportedRosterForLeagueMock.mockResolvedValue({
      mappedSlots: { QB: 1, RB: 2 },
      unmappedSlots: ['W/T'],
      validation: { valid: true, warnings: [], errors: [] },
    })

    const { POST } = await import('../app/api/commissioner/leagues/[leagueId]/roster-settings/import/route')
    const res = await POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePlatform: 'yahoo', importedConfig: { QB: 1, RB: 2, 'W/T': 1 } }),
      }) as any,
      { params: Promise.resolve({ leagueId: 'l1' }) },
    )

    expect(previewImportedRosterForLeagueMock).toHaveBeenCalledWith('l1', 'yahoo', { QB: 1, RB: 2, 'W/T': 1 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      action: 'preview',
      mappedSlots: { QB: 1, RB: 2 },
      unmappedSlots: ['W/T'],
      validation: { valid: true, warnings: [], errors: [] },
    })
  })

  it('applies import when action is apply', async () => {
    mapImportedRosterToLeagueConfigMock.mockResolvedValue({
      sport: 'NFL',
      leagueType: 'redraft',
      rosterTemplateKey: 'custom',
      rosterSource: 'CUSTOM',
      rosterConfigVersion: 2,
      rosterLastUpdatedAt: '2026-04-12T00:00:00.000Z',
      rosterLastUpdatedBy: 'import-mapper',
      rosterIsCustom: true,
      rosterMatchesTemplate: false,
      rosterWarnings: [],
      rosterConfig: { sections: [{ key: 'primary', label: 'Primary', slots: { QB: 1 } }] },
    })

    const { POST } = await import('../app/api/commissioner/leagues/[leagueId]/roster-settings/import/route')
    const res = await POST(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply', sourcePlatform: 'yahoo', importedConfig: { QB: 1 } }),
      }) as any,
      { params: Promise.resolve({ leagueId: 'l1' }) },
    )

    expect(mapImportedRosterToLeagueConfigMock).toHaveBeenCalledWith('l1', 'yahoo', { QB: 1 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      action: 'apply',
      unifiedConfig: {
        sport: 'NFL',
        leagueType: 'redraft',
        rosterTemplateKey: 'custom',
        rosterSource: 'CUSTOM',
        rosterConfigVersion: 2,
        rosterLastUpdatedAt: '2026-04-12T00:00:00.000Z',
        rosterLastUpdatedBy: 'import-mapper',
        rosterIsCustom: true,
        rosterMatchesTemplate: false,
        rosterWarnings: [],
        rosterConfig: { sections: [{ key: 'primary', label: 'Primary', slots: { QB: 1 } }] },
      },
    })
  })
})
