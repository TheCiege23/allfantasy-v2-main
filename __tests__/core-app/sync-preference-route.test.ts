import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
const h = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), league: vi.fn(), save: vi.fn() }))
vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: h.auth }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: h.access }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.league } } }))
vi.mock('@/lib/core-app/syncPreferences', () => ({ setSyncPaused: h.save }))
import { POST } from '@/app/api/core/sync/preference/route'
async function call(body: unknown) {
  const response = await POST({ json: async () => body } as NextRequest)
  return { status: response.status, body: await response.json() }
}
beforeEach(() => {
  vi.resetAllMocks()
  h.auth.mockResolvedValue({ ok: true, userId: 'current-account' })
  h.access.mockResolvedValue({ isMember: true })
  h.league.mockResolvedValue({ platform: 'sleeper', platformLeagueId: '123' })
  h.save.mockResolvedValue(undefined)
})
describe('account sync pause', () => {
  it.each([true, false])('saves pause=%s using session identity and the accessible league key', async paused => {
    expect((await call({ leagueId: 'native-id', paused, userId: 'victim', key: 'espn:other' })).status).toBe(200)
    expect(h.access).toHaveBeenCalledWith('native-id', 'current-account')
    expect(h.save).toHaveBeenCalledWith('current-account', 'sleeper:123', paused)
  })
  it('does not read or edit a league unavailable to this account', async () => {
    h.access.mockResolvedValue(null)
    expect((await call({ leagueId: 'other', paused: true })).status).toBe(403)
    expect(h.league).not.toHaveBeenCalled()
    expect(h.save).not.toHaveBeenCalled()
  })
  it('rejects malformed pause values', async () => {
    expect((await call({ leagueId: 'native-id', paused: 'true' })).status).toBe(400)
    expect(h.save).not.toHaveBeenCalled()
  })
  it('rejects unsupported connections', async () => {
    h.league.mockResolvedValue({ platform: 'manual', platformLeagueId: null })
    expect((await call({ leagueId: 'native-id', paused: true })).status).toBe(400)
    expect(h.save).not.toHaveBeenCalled()
  })
  it('reports a failed save without claiming success', async () => {
    h.save.mockRejectedValue(new Error('database unavailable'))
    expect((await call({ leagueId: 'native-id', paused: true })).status).toBe(503)
  })
})
