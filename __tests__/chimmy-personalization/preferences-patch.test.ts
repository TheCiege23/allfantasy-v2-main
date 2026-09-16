import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The settings endpoint: `null` clears a setting, team direction and forget are wired, and a league
 * the user cannot access is refused without saying whether it exists.
 */

const h = vi.hoisted(() => ({
  resolvePlatformUser: vi.fn(),
  resolveProfile: vi.fn(),
  updateSettings: vi.fn(),
  listRemembered: vi.fn(),
  listLeagues: vi.fn(),
  setDirection: vi.fn(),
  forget: vi.fn(),
  getAiMemory: vi.fn(),
  upsertAiMemory: vi.fn(),
  recordQuality: vi.fn(),
}))

vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: h.resolvePlatformUser }))
vi.mock('@/lib/chimmy-personalization/remembered', () => ({
  listRememberedPreferences: h.listRemembered,
  listPreferenceLeagueOptions: h.listLeagues,
  setRememberedTeamDirection: h.setDirection,
  forgetRememberedPreferences: h.forget,
}))

describe('PATCH /api/user/chimmy-personalization', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.doMock('@/lib/chimmy-personalization', () => ({
      resolveChimmyPersonalizationProfile: h.resolveProfile,
      updateChimmyPersonalizationSettings: h.updateSettings,
    }))
    h.resolvePlatformUser.mockResolvedValue({ appUserId: 'u1' })
    h.resolveProfile.mockResolvedValue({ userId: 'u1' })
    h.updateSettings.mockResolvedValue({})
    h.listRemembered.mockResolvedValue([{ leagueId: null }])
    h.listLeagues.mockResolvedValue([])
    h.setDirection.mockResolvedValue('ok')
    h.forget.mockResolvedValue('ok')
  })

  async function patch(body: unknown) {
    const { PATCH } = await import('@/app/api/user/chimmy-personalization/route')
    const res = await PATCH(
      new Request('http://localhost/api/user/chimmy-personalization', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }) as never,
    )
    return { status: res.status, body: await res.json() }
  }

  it('passes null through, which is how a setting is cleared', async () => {
    const { status } = await patch({ riskPreference: null, explanationStyle: 'detailed' })
    expect(status).toBe(200)
    expect(h.updateSettings).toHaveBeenCalledWith('u1', { riskPreference: null, explanationStyle: 'detailed' })
  })

  it('rejects an unknown key rather than silently ignoring it', async () => {
    const { status } = await patch({ riskPrefrence: 'upside' })
    expect(status).toBe(400)
    expect(h.updateSettings).not.toHaveBeenCalled()
  })

  it('sets a team direction and returns the fresh snapshot', async () => {
    const { status, body } = await patch({ teamDirection: { leagueId: 'L1', value: 'rebuilder' } })
    expect(status).toBe(200)
    expect(h.setDirection).toHaveBeenCalledWith('u1', 'L1', 'rebuilder')
    // A direction-only change touches no explicit setting.
    expect(h.updateSettings).not.toHaveBeenCalled()
    expect(body.remembered).toEqual([{ leagueId: null }])
  })

  it('refuses an inaccessible league with one status and one message', async () => {
    h.setDirection.mockResolvedValue('forbidden')
    const { status, body } = await patch({ teamDirection: { leagueId: 'L9', value: 'contender' } })
    expect(status).toBe(403)
    expect(body).toEqual({ error: 'League not available' })
    expect(JSON.stringify(body)).not.toContain('L9')
  })

  it('forgets a league', async () => {
    const { status } = await patch({ forget: { leagueId: 'L1' } })
    expect(status).toBe(200)
    expect(h.forget).toHaveBeenCalledWith('u1', 'L1')
  })

  it('requires a signed-in user', async () => {
    h.resolvePlatformUser.mockResolvedValue({ appUserId: null })
    const { status } = await patch({ riskPreference: 'upside' })
    expect(status).toBe(401)
    expect(h.updateSettings).not.toHaveBeenCalled()
  })
})

describe('updateChimmyPersonalizationSettings', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.doUnmock('@/lib/chimmy-personalization')
    vi.doMock('@/lib/ai-memory/ai-memory-store', () => ({
      getAiMemory: h.getAiMemory,
      upsertAiMemory: h.upsertAiMemory,
    }))
    vi.doMock('@/lib/chimmy-quality/ChimmyQualityAnalytics', () => ({ recordChimmyQualityEvent: h.recordQuality }))
    vi.doMock('@/lib/prisma', () => ({ prisma: {} }))
    h.upsertAiMemory.mockResolvedValue({ id: 'x' })
    h.recordQuality.mockResolvedValue(undefined)
  })

  /*
   * 🛑 THE WAY BACK. Before, `partial` was spread over the stored object, so a value, once chosen,
   * could never be removed — only replaced.
   */
  it('removes a setting sent as null and leaves the rest alone', async () => {
    h.getAiMemory.mockResolvedValue({ explanationStyle: 'detailed', riskPreference: 'upside' })
    const { updateChimmyPersonalizationSettings } = await import('@/lib/chimmy-personalization/service')

    const next = await updateChimmyPersonalizationSettings('u1', { riskPreference: null })

    const stored = h.upsertAiMemory.mock.calls[0][0].value
    expect(stored).not.toHaveProperty('riskPreference')
    expect(stored).toMatchObject({ explanationStyle: 'detailed' })
    expect(next).not.toHaveProperty('riskPreference')
  })

  it('treats an absent key as "leave it alone"', async () => {
    h.getAiMemory.mockResolvedValue({ explanationStyle: 'detailed', riskPreference: 'upside' })
    const { updateChimmyPersonalizationSettings } = await import('@/lib/chimmy-personalization/service')

    await updateChimmyPersonalizationSettings('u1', { explanationStyle: 'concise' })

    expect(h.upsertAiMemory.mock.calls[0][0].value).toMatchObject({ explanationStyle: 'concise', riskPreference: 'upside' })
  })
})
