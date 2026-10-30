import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const h = vi.hoisted(() => ({ allowed: vi.fn(), mayAct: vi.fn(), right: vi.fn(), eligibility: vi.fn(), execute: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'manager' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { devyRights: { findUnique: h.right } } }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: h.allowed, canSubmitPickForRoster: h.mayAct }))
vi.mock('@/lib/merged-devy-c2c/C2CLeagueConfig', () => ({ isC2CLeague: vi.fn(async () => true), getC2CConfig: vi.fn() }))
vi.mock('@/lib/merged-devy-c2c/promotion/C2CPromotionService', () => ({ checkC2CPromotionEligibility: h.eligibility, executeC2CPromotion: h.execute }))
import { POST } from '@/app/api/leagues/[leagueId]/merged-devy-c2c/promotion/route'
const request = () => new NextRequest('http://localhost/api/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rightsId: 'right', promotedProPlayerId: 'player' }) })
describe('C2C promotion authorization', () => {
  beforeEach(() => { vi.clearAllMocks(); h.allowed.mockResolvedValue(true); h.right.mockResolvedValue({ leagueId: 'league', rosterId: 'roster' }); h.eligibility.mockResolvedValue({ canPromote: true }); h.execute.mockResolvedValue({ ok: true }) })
  it('denies a league member who cannot act for the rights holder', async () => {
    h.mayAct.mockResolvedValue(false)
    const response = await POST(request(), { params: Promise.resolve({ leagueId: 'league' }) })
    expect(response.status).toBe(403)
    expect(h.mayAct).toHaveBeenCalledWith('league', 'manager', 'roster')
    expect(h.eligibility).not.toHaveBeenCalled()
    expect(h.execute).not.toHaveBeenCalled()
  })
  it('allows an authorized manager to promote eligible rights', async () => {
    h.mayAct.mockResolvedValue(true)
    const response = await POST(request(), { params: Promise.resolve({ leagueId: 'league' }) })
    expect(response.status).toBe(200)
    expect(h.execute).toHaveBeenCalledOnce()
  })
  it('rejects rights from a different league before authorizing', async () => {
    h.right.mockResolvedValue({ leagueId: 'other', rosterId: 'roster' })
    const response = await POST(request(), { params: Promise.resolve({ leagueId: 'league' }) })
    expect(response.status).toBe(404)
    expect(h.mayAct).not.toHaveBeenCalled()
  })
})
