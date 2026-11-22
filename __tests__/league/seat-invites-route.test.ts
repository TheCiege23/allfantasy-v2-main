// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const fake = vi.hoisted(() => ({
  access: vi.fn(), seat: vi.fn(), create: vi.fn(), find: vi.fn(), update: vi.fn(), send: vi.fn(), check: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'commissioner' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/commissionerAccess', () => ({ commissionerAccessResponse: fake.access }))
vi.mock('@/lib/league-privacy', () => ({ getLeaguePrivacySettings: async () => ({ allowEmailInvite: true }) }))
vi.mock('@/lib/resend-client', () => ({ getResendClient: () => ({ fromEmail: 'qa@example.test', client: { emails: { send: fake.send } } }) }))
vi.mock('@/lib/http/served-origin', () => ({ getServedOrigin: () => 'https://qa.example.test' }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => ({ success: true }) }))
vi.mock('@/lib/core-app/teamDeliveryReconciliation', () => ({ checkProviderDelivery: fake.check }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: async () => ({ id: 'league-1', name: 'QA league', platform: 'allfantasy', settings: { inviteCode: 'test', inviteExpiresAt: '2030-01-01' } }) },
    leagueTeam: { findFirst: fake.seat },
    appUser: { findFirst: async () => null },
    leagueSeatInvite: { create: fake.create, findFirst: fake.find, findUnique: fake.find, updateMany: fake.update },
  },
}))

import { POST } from '@/app/api/commissioner/leagues/[leagueId]/invite/send/route'
import { GET, PATCH } from '@/app/api/commissioner/leagues/[leagueId]/invite/seat-history/route'
import { recordSeatInviteProviderEvent } from '@/lib/league/seatInvites'

const ctx = { params: Promise.resolve({ leagueId: 'league-1' }) }
const req = (method: string, body?: object) => new NextRequest('https://qa.example.test/?leagueTeamId=team-1', {
  method, ...(body ? { body: JSON.stringify(body) } : {}),
})

beforeEach(() => {
  vi.resetAllMocks()
  fake.seat.mockResolvedValue({ id: 'team-1', claimedByUserId: null, invites: [] })
  fake.create.mockResolvedValue({ id: 'attempt-1' })
  fake.send.mockResolvedValue({ data: { id: 'provider-1' } })
})

it('saves the attempt and its masked email on the correct seat before sending', async () => {
  const response = await POST(req('POST', { type: 'email', email: 'manager@example.test', leagueTeamId: 'team-1' }), ctx)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ inviteId: 'attempt-1', sent: true })
  expect(fake.create).toHaveBeenCalledWith(expect.objectContaining({ data: { leagueTeamId: 'team-1', recipientLabel: 'm***@example.test' } }))
  expect(fake.create.mock.invocationCallOrder[0]).toBeLessThan(fake.send.mock.invocationCallOrder[0]!)
  expect(fake.send).toHaveBeenCalledWith(expect.objectContaining({ tags: [{ name: 'af_seat_invite', value: 'attempt-1' }] }), expect.anything())
  expect(fake.update).toHaveBeenCalledWith({ where: { id: 'attempt-1', status: 'SENDING' }, data: { status: 'ACCEPTED', providerMessageId: 'provider-1' } })
})

it('blocks out-of-league seats and protects commissioner-only history', async () => {
  fake.seat.mockResolvedValueOnce(null)
  const response = await POST(req('POST', { type: 'email', email: 'manager@example.test', leagueTeamId: 'other-league' }), ctx)
  expect(response.status).toBe(404)
  expect(fake.send).not.toHaveBeenCalled()
  fake.access.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
  expect((await GET(req('GET'), ctx)).status).toBe(403)
})

it('retrieves delivery through the provider and updates only pending attempts', async () => {
  fake.find.mockResolvedValueOnce({ id: 'attempt-1', status: 'ACCEPTED', providerMessageId: 'provider-1' })
    .mockResolvedValueOnce({ id: 'attempt-1', status: 'DELIVERED' })
  fake.check.mockResolvedValueOnce({ status: 'delivered' })
  const result = await PATCH(req('PATCH', { inviteId: 'attempt-1' }), ctx)
  expect(await result.json()).toEqual({ invite: { id: 'attempt-1', status: 'DELIVERED' } })
  expect(fake.find).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'attempt-1', team: { leagueId: 'league-1' } } }))
  expect(fake.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { status: { in: ['SENDING', 'ACCEPTED', 'DELAYED'] }, OR: [{ providerMessageId: 'provider-1' }] },
    data: { status: 'DELIVERED', providerMessageId: 'provider-1' },
  }))
})

it('rejects old sent events and can record a signed webhook that precedes the send response', async () => {
  await recordSeatInviteProviderEvent('provider-1', 'email.sent', 'attempt-1')
  expect(fake.update).not.toHaveBeenCalled()
  await recordSeatInviteProviderEvent('provider-1', 'email.bounced', 'attempt-1')
  expect(fake.update).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ OR: [{ providerMessageId: 'provider-1' }, { id: 'attempt-1', providerMessageId: null }] }),
    data: { status: 'FAILED', providerMessageId: 'provider-1' },
  }))
})
