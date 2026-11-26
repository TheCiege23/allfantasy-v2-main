import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSession = vi.fn()
const isCommissioner = vi.fn()
const checkNativeReadiness = vi.fn()
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { marker: 'prisma' } }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: (...a: unknown[]) => isCommissioner(...a) }))
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
    isCommissioner.mockResolvedValue(false)
    expect((await call()).status).toBe(403)
    expect(isCommissioner).toHaveBeenCalledWith('L', 'u')
    expect(checkNativeReadiness).not.toHaveBeenCalled()
  })

  it('returns the report to the commissioner, uncached', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u' } })
    isCommissioner.mockResolvedValue(true)
    checkNativeReadiness.mockResolvedValue({ leagueId: 'L', status: 'ready', items: [] })
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toMatchObject({ status: 'ready' })
  })

  it('500s with a plain message, not the internal error', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u' } })
    isCommissioner.mockResolvedValue(true)
    checkNativeReadiness.mockRejectedValue(new Error('connection to 10.0.0.1 refused'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('10.0.0.1')
  })
})
