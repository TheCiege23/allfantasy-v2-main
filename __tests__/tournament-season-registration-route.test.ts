import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ session: vi.fn(), freeze: vi.fn(), open: vi.fn(), pause: vi.fn(), join: vi.fn(), change: vi.fn(), load: vi.fn(), legacyShell: vi.fn(), legacyMember: vi.fn(), legacyDelete: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/tournament/seasonBlueprintStore', () => ({ BlueprintOperationError: class extends Error { constructor(message: string, public status: number) { super(message) } } }))
vi.mock('@/lib/tournament/seasonRegistration', () => ({ freezeSeasonOpeningField: mocks.freeze, openSeasonRegistration: mocks.open, pauseSeasonRegistration: mocks.pause, joinSeasonTournament: mocks.join, changeSeasonEntry: mocks.change, loadSeasonRegistration: mocks.load }))
vi.mock('@/lib/prisma', () => ({ prisma: { tournamentShell: { findUnique: mocks.legacyShell }, tournamentParticipant: { findFirst: mocks.legacyMember, delete: mocks.legacyDelete } } }))
import { DELETE as legacyWithdraw } from '@/app/api/tournament/register/route'
import { GET, POST } from '@/app/api/tournament/season-registration/route'
import { BlueprintOperationError } from '@/lib/tournament/seasonBlueprintStore'
const request = (body: unknown) => new NextRequest('https://test/api/tournament/season-registration', { method: 'POST', body: JSON.stringify(body) })
const join = { action: 'join', tournamentId: 't1', token: 'a'.repeat(64), publicationId: 'pub1', acceptedHash: 'rule-hash', acceptedRules: true }
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ user: { id: 'real-user' } }) })
describe('season registration API', () => {
  it('authenticates before inspecting registration', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await POST(request(join))).status).toBe(401)
    expect((await GET(new NextRequest('https://test/api/tournament/season-registration?tournamentId=t1'))).status).toBe(401)
    expect(mocks.join).not.toHaveBeenCalled()
  })
  it.each([false, undefined])('requires explicit rule acceptance %s', acceptedRules => {
    return POST(request({ ...join, acceptedRules })).then(r => expect(r.status).toBe(400))
  })
  it('joins only the authenticated user against the submitted frozen version', async () => {
    mocks.join.mockResolvedValue({ participantId: 'p1', status: 'registered' })
    expect((await POST(request({ ...join, userId: 'forged' }))).status).toBe(200)
    expect(mocks.join).toHaveBeenCalledWith('real-user', 't1', 'a'.repeat(64), 'pub1', 'rule-hash')
  })
  it('ignores a forged withdrawal target', async () => {
    mocks.change.mockResolvedValue({ ok: true })
    expect((await POST(request({ action: 'withdraw', tournamentId: 't1', participantId: 'someone-else' }))).status).toBe(200)
    expect(mocks.change).toHaveBeenCalledWith('real-user', 't1', 'withdraw')
  })
  it('rejects blank removal reasons and oversized waitlists', async () => {
    expect((await POST(request({ action: 'remove', tournamentId: 't1', participantId: 'p1', reason: ' ' }))).status).toBe(400)
    expect((await POST(request({ action: 'open', tournamentId: 't1', publicationId: 'pub1', closesAt: '2026-10-17T00:00:00Z', waitlistLimit: 193 }))).status).toBe(400)
  })
  it('leaves owner authorization to the registration service', async () => {
    mocks.open.mockRejectedValue(new BlueprintOperationError('Owner only.', 403))
    expect((await POST(request({ action: 'open', tournamentId: 't1', publicationId: 'pub1', closesAt: '2026-10-17T00:00:00Z', waitlistLimit: 64 }))).status).toBe(403)
    expect(mocks.open).toHaveBeenCalledWith('real-user', 't1', 'pub1', '2026-10-17T00:00:00Z', 64)
  })
  it('returns a private owner board without caching', async () => {
    mocks.load.mockResolvedValue({ registered: 10 })
    const response = await GET(new NextRequest('https://test/api/tournament/season-registration?tournamentId=t1'))
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.load).toHaveBeenCalledWith('real-user', 't1')
  })
  it('returns safe errors without exposing request tokens or raw database failures', async () => {
    mocks.join.mockRejectedValue(new Error('secret database host'))
    const response = await POST(request(join))
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(text).not.toContain('secret database host')
    expect(text).not.toContain(join.token)
  })
})

it('blocks owner removals through the legacy registration endpoint', async () => {
  mocks.legacyShell.mockResolvedValue({ id: 't1', commissionerId: 'real-user', status: 'rules_published' })
  mocks.legacyMember.mockResolvedValue({ id: 'p1', tournamentId: 't1', userId: 'entrant' })
  expect((await legacyWithdraw(new NextRequest('https://test/api/tournament/register?tournamentId=t1&participantId=p1', { method: 'DELETE' }))).status).toBe(409)
  expect(mocks.legacyDelete).not.toHaveBeenCalled()
})

it('freezes only on behalf of the authenticated account and specified publication', async () => {
  mocks.freeze.mockResolvedValue({ freezeId: 'f1' })
  const response = await POST(request({ action: 'freeze', tournamentId: 't1', publicationId: 'pub1', userId: 'forged' }))
  expect(response.status).toBe(200)
  expect(mocks.freeze).toHaveBeenCalledWith('real-user', 't1', 'pub1')
  expect(response.headers.get('Cache-Control')).toBe('no-store')
})
