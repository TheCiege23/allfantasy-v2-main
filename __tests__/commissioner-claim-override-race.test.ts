// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const h = vi.hoisted(() => ({ session: vi.fn(), role: vi.fn(), find: vi.fn(), update: vi.fn(), audit: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: h.role }))
vi.mock('@/lib/prisma', () => ({ prisma: { waiverClaim: { findFirst: h.find, updateMany: h.update } } }))
vi.mock('@/server/services/auditService', () => ({ logAction: h.audit }))
import { PATCH } from '@/app/api/commissioner/leagues/[leagueId]/waiver-claims/[claimId]/route'
const request = (body: string) => PATCH(new NextRequest('http://example.test/claim', { method: 'PATCH', body }), { params: Promise.resolve({ leagueId: 'L1', claimId: 'C1' }) })
beforeEach(() => { vi.clearAllMocks(); h.session.mockResolvedValue({ user: { id: 'U1' } }); h.role.mockResolvedValue('commissioner'); h.find.mockResolvedValue({ id: 'C1', leagueId: 'L1', status: 'pending', metadata: { custom: true } }); h.update.mockResolvedValue({ count: 1 }); h.audit.mockResolvedValue(undefined) })
describe('commissioner pending claim override', () => {
  it.each(['{', 'null', '[]', '{}', '{"bypassInsufficientFaab":"true"}', '{"unknown":true}'])('rejects malformed override %s before storage', async body => {
    expect((await request(body)).status).toBe(400)
    expect(h.find).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })
  it('guards the pending state and original metadata in the atomic write', async () => {
    expect((await request('{"bypassInsufficientFaab":false,"note":"reviewed"}')).status).toBe(200)
    expect(h.update).toHaveBeenCalledWith({ where: { id: 'C1', leagueId: 'L1', status: 'pending', metadata: { equals: { custom: true } } }, data: { metadata: expect.objectContaining({ custom: true, commissionerOverrides: expect.objectContaining({ bypassInsufficientFaab: false, note: 'reviewed', setByUserId: 'U1' }) }) } })
    expect(h.audit).toHaveBeenCalledTimes(1)
  })
  it('reports a processing or edit race without claiming success or auditing it', async () => {
    h.update.mockResolvedValue({ count: 0 })
    expect((await request('{"bypassWeeklyDropLimit":true}')).status).toBe(409)
    expect(h.audit).not.toHaveBeenCalled()
  })
  it('blocks non-commissioners before reading the claim', async () => {
    h.role.mockResolvedValue('member')
    expect((await request('{"note":"x"}')).status).toBe(403)
    expect(h.find).not.toHaveBeenCalled()
  })
})
