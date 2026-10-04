// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const h = vi.hoisted(() => ({ session: vi.fn(), authorize: vi.fn(), process: vi.fn(), lock: vi.fn(), history: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: h.authorize }))
vi.mock('@/lib/waiver-wire', () => ({ getEffectiveLeagueWaiverSettings: vi.fn(), upsertLeagueWaiverSettings: vi.fn(), getPendingClaims: vi.fn(), getProcessedClaimsAndTransactions: h.history }))
vi.mock('@/lib/waiver-wire/process-engine', () => ({ processWaiverClaimsForLeague: h.process }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ setWaiverProcessingLocked: h.lock }))
import { GET, POST } from '@/app/api/commissioner/leagues/[leagueId]/waivers/route'
const ctx = () => ({ params: Promise.resolve({ leagueId: 'L1' }) })
const request = (body?: string) => new NextRequest('https://example.test/api/commissioner/leagues/L1/waivers', { method: 'POST', ...(body === undefined ? {} : { body }) })
beforeEach(() => { vi.clearAllMocks(); h.session.mockResolvedValue({ user: { id: 'U1' } }); h.authorize.mockResolvedValue(undefined); h.process.mockResolvedValue([]); h.history.mockResolvedValue({ claims: [], transactions: [] }) })
describe('commissioner waiver action boundary', () => {
  it.each(['{"action":"typo"}', '{', 'null', '[]', '{"action":7}', '{"unexpected":true}'])('does not process invalid input %s', async body => {
    expect((await POST(request(body), ctx())).status).toBe(400)
    expect(h.process).not.toHaveBeenCalled()
    expect(h.lock).not.toHaveBeenCalled()
  })
  it.each([undefined, '{}', '{"action":"process"}'])('supports explicit and legacy manual-run requests %s', async body => {
    expect((await POST(request(body), ctx())).status).toBe(200)
    expect(h.process).toHaveBeenCalledWith('L1', { processedByUserId: 'U1', runType: 'manual' })
  })
  it('blocks non-commissioners before any mutation', async () => {
    h.authorize.mockRejectedValue(new Error('Forbidden'))
    expect((await POST(request('{"action":"process"}'), ctx())).status).toBe(403)
    expect(h.process).not.toHaveBeenCalled()
  })
  it('passes a finite integer limit to history for malformed query input', async () => {
    await GET(new NextRequest('https://example.test/api/commissioner/leagues/L1/waivers?type=history&limit=oops'), ctx())
    expect(h.history).toHaveBeenCalledWith('L1', 50)
  })
})
