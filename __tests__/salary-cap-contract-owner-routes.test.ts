import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), cut: vi.fn(), extend: vi.fn(), tag: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: mocks.access }))
vi.mock('@/lib/salary-cap/SalaryCapLeagueConfig', () => ({ isSalaryCapLeague: vi.fn(async () => true), getSalaryCapConfig: vi.fn(async () => null) }))
vi.mock('@/lib/salary-cap/DeadMoneyService', () => ({ applyCut: mocks.cut }))
vi.mock('@/lib/salary-cap/ExtensionService', () => ({ applyExtension: mocks.extend }))
vi.mock('@/lib/salary-cap/FranchiseTagService', () => ({ applyFranchiseTag: mocks.tag }))
vi.mock('@/lib/salary-cap/CapCalculationService', () => ({ getOrCreateLedger: vi.fn() }))
import { POST as cut } from '@/app/api/leagues/[leagueId]/salary-cap/cut/route'
import { POST as extend } from '@/app/api/leagues/[leagueId]/salary-cap/extension/route'
import { POST as tag } from '@/app/api/leagues/[leagueId]/salary-cap/franchise-tag/route'

const routes = [['cut', cut, mocks.cut], ['extension', extend, mocks.extend], ['tag', tag, mocks.tag]] as const
beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'server-user' } })
  mocks.access.mockResolvedValue(true)
  for (const mutation of [mocks.cut, mocks.extend, mocks.tag]) mutation.mockResolvedValue({ ok: false, error: 'Forbidden', status: 403 })
})
const request = () => new NextRequest('http://localhost/api/leagues/L/salary-cap/action', { method: 'POST',
  body: JSON.stringify({ contractId: 'contract', capYear: 2026, newYears: 2, newSalary: 30, actorUserId: 'forged-commissioner' }),
  headers: { 'Content-Type': 'application/json' } })

describe('salary mutation routes use server identity', () => {
  it.each(routes)('%s forwards the authenticated actor and preserves forbidden responses', async (_name, route, mutation) => {
    const response = await route(request(), { params: Promise.resolve({ leagueId: 'L' }) })
    expect(response.status).toBe(403)
    expect(mutation.mock.calls[0].at(-1)).toBe('server-user')
    expect(mutation.mock.calls[0]).not.toContain('forged-commissioner')
  })
  it.each(routes)('%s refuses an anonymous request before mutation', async (_name, route, mutation) => {
    mocks.session.mockResolvedValue(null)
    expect((await route(request(), { params: Promise.resolve({ leagueId: 'L' }) })).status).toBe(401)
    expect(mutation).not.toHaveBeenCalled()
  })
  it.each(routes)('%s preserves an allowed mutation', async (_name, route, mutation) => {
    mutation.mockResolvedValue({ ok: true })
    expect((await route(request(), { params: Promise.resolve({ leagueId: 'L' }) })).status).toBe(200)
  })
})
