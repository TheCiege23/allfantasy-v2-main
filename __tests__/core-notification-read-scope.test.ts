// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const updateMany = vi.hoisted(() => vi.fn())
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'user1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { platformNotification: { updateMany } } }))
vi.mock('@/lib/user-settings', () => ({ getSettingsProfile: vi.fn(), updateUserProfile: vi.fn() }))
import { PATCH } from '@/app/api/user/notifications/route'
beforeEach(() => vi.clearAllMocks())
const request = (body: object) => PATCH(new NextRequest('http://localhost/api/user/notifications', {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))
it('marks only the signed-in user’s selected league', async () => {
  expect((await request({ ids: 'all', leagueId: 'league1' })).status).toBe(200)
  expect(updateMany.mock.calls[0][0].where).toEqual({ userId: 'user1', readAt: null, leagueId: 'league1' })
})
it('retains account-wide mark-all when no league is selected', async () => {
  expect((await request({ ids: 'all' })).status).toBe(200)
  expect(updateMany.mock.calls[0][0].where).toEqual({ userId: 'user1', readAt: null })
})
it('rejects malformed scope instead of clearing the whole account', async () => {
  expect((await request({ ids: 'all', leagueId: 3 })).status).toBe(400)
  expect(updateMany).not.toHaveBeenCalled()
})
