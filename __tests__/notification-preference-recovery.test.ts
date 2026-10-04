// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ session: vi.fn(), read: vi.fn(), update: vi.fn(), create: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { userProfile: { findUnique: h.read, updateMany: h.update, create: h.create } } }))
import { PUT } from '@/app/api/user/notifications/route'
const request = (body: string) => PUT(new Request('https://example.test/prefs', { method: 'PUT', body }))
beforeEach(() => { vi.clearAllMocks(); h.session.mockResolvedValue({ user: { id: 'U1' } }); h.read.mockResolvedValue({ notificationPreferences: { leagueOverrides: { L1: { muted: true } }, dashboardToggles: { injuryAlerts: false } } }); h.update.mockResolvedValue({ count: 1 }); h.create.mockResolvedValue({}) })
describe('notification preference recovery', () => {
  it.each(['{', 'null', '[]', '{}', '{"dashboardToggles":[]}', '{"dashboardToggles":{"injuryAlerts":"false"}}', '{"dashboardToggles":{"unknown":true}}'])('rejects malformed input %s', async body => {
    expect((await request(body)).status).toBe(400)
    expect(h.read).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })
  it('preserves other preferences and explicit false with a compare-and-set write', async () => {
    expect((await request('{"dashboardToggles":{"tradeActivity":false}}')).status).toBe(200)
    const call = h.update.mock.calls[0][0]
    expect(call.where).toEqual({ userId: 'U1', notificationPreferences: { equals: { leagueOverrides: { L1: { muted: true } }, dashboardToggles: { injuryAlerts: false } } } })
    expect(call.data.notificationPreferences).toMatchObject({ leagueOverrides: { L1: { muted: true } }, dashboardToggles: { injuryAlerts: false, tradeActivity: false } })
  })
  it('does not write after an unverified read', async () => {
    h.read.mockRejectedValue(new Error('offline'))
    expect((await request('{"dashboardToggles":{"injuryAlerts":true}}')).status).toBe(503)
    expect(h.update).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })
  it('does not overwrite malformed stored preferences', async () => {
    h.read.mockResolvedValue({ notificationPreferences: [] })
    expect((await request('{"dashboardToggles":{"injuryAlerts":true}}')).status).toBe(503)
    expect(h.update).not.toHaveBeenCalled()
  })
  it('reports concurrent preference changes without overwriting them', async () => {
    h.update.mockResolvedValue({ count: 0 })
    expect((await request('{"dashboardToggles":{"injuryAlerts":true}}')).status).toBe(409)
  })
  it('creates preferences for a verified missing profile', async () => {
    h.read.mockResolvedValue(null)
    expect((await request('{"dashboardToggles":{"injuryAlerts":false}}')).status).toBe(200)
    expect(h.create).toHaveBeenCalledWith({ data: { userId: 'U1', notificationPreferences: expect.objectContaining({ dashboardToggles: expect.objectContaining({ injuryAlerts: false }) }) } })
  })
  it('reports a competing profile creation as a conflict', async () => {
    h.read.mockResolvedValue(null)
    h.create.mockRejectedValue({ code: 'P2002' })
    expect((await request('{"dashboardToggles":{"injuryAlerts":false}}')).status).toBe(409)
  })
})
