import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSession = vi.fn()
const commissionerAccessResponse = vi.fn()
const checkNativeReadiness = vi.fn()
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { marker: 'prisma' } }))
vi.mock('@/lib/league/commissionerAccess', () => ({ commissionerAccessResponse: (...a: unknown[]) => commissionerAccessResponse(...a) }))
vi.mock('@/lib/league/nativeReadiness', () => ({ checkNativeReadiness: (...a: unknown[]) => checkNativeReadiness(...a) }))

import { GET } from '@/app/api/leagues/[leagueId]/native-readiness/route'

const call = () => GET(new Request('http://localhost/api/leagues/L/native-readiness'), { params: Promise.resolve({ leagueId: 'L' }) })

describe('GET /api/leagues/[leagueId]/native-readiness', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('401s a signed-out caller without checking anything', async () => {
    getServerSession.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(checkNativeReadiness).not.toHaveBeenCalled()
  })

  it('403s anyone who is not the head commissioner', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u' } })
    commissionerAccessResponse.mockResolvedValue(new Response(JSON.stringify({ error: 'Only the head commissioner can do this.' }), { status: 403 }))
    expect((await call()).status).toBe(403)
    expect(commissionerAccessResponse).toHaveBeenCalledWith('L', 'u', 'head')
    expect(checkNativeReadiness).not.toHaveBeenCalled()
  })

  it('returns the report to the commissioner, uncached', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u' } })
    commissionerAccessResponse.mockResolvedValue(null)
    checkNativeReadiness.mockResolvedValue({ leagueId: 'L', status: 'ready', items: [] })
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toMatchObject({ status: 'ready' })
  })

  it('500s with a plain message, not the internal error', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u' } })
    commissionerAccessResponse.mockResolvedValue(null)
    checkNativeReadiness.mockRejectedValue(new Error('connection to 10.0.0.1 refused'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('10.0.0.1')
  })
})
