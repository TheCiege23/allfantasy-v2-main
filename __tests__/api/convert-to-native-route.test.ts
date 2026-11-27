import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSession = vi.fn()
const commissionerAccessResponse = vi.fn()
const requireAdmin = vi.fn()
const convert = vi.fn()
const { NativeConversionRefusal } = vi.hoisted(() => ({
  NativeConversionRefusal: class extends Error {
    constructor(message: string, readonly blockers: unknown[] = []) { super(message) }
  },
}))
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { marker: 'prisma' } }))
vi.mock('@/lib/adminAuth', () => ({ requireAdmin: () => requireAdmin() }))
vi.mock('@/lib/league/commissionerAccess', () => ({ commissionerAccessResponse: (...a: unknown[]) => commissionerAccessResponse(...a) }))
vi.mock('@/lib/league/convertImportedLeagueInPlace', () => ({ convertImportedLeagueInPlace: (...a: unknown[]) => convert(...a), NativeConversionRefusal }))

import { POST } from '@/app/api/leagues/[leagueId]/convert-to-native/route'

const call = (body: unknown = {}) => POST(new Request('http://localhost/api/leagues/L/convert-to-native', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ leagueId: 'L' }) })
const signedInHeadAdmin = () => {
  getServerSession.mockResolvedValue({ user: { id: 'u' } })
  commissionerAccessResponse.mockResolvedValue(null)
  requireAdmin.mockResolvedValue({ ok: true, user: {} })
}

describe('POST /api/leagues/[leagueId]/convert-to-native', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('401s a signed-out caller', async () => {
    getServerSession.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(convert).not.toHaveBeenCalled()
  })

  it('asks the one commissioner rule for the head commissioner', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u' } })
    commissionerAccessResponse.mockResolvedValue(new Response('{}', { status: 403 }))
    expect((await call()).status).toBe(403)
    expect(commissionerAccessResponse).toHaveBeenCalledWith('L', 'u', 'head')
    expect(convert).not.toHaveBeenCalled()
  })

  it('refuses a head commissioner who is not an AllFantasy admin while the switch is a pilot', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u' } })
    commissionerAccessResponse.mockResolvedValue(null)
    requireAdmin.mockResolvedValue({ ok: false, res: new Response(null, { status: 403 }) })
    const res = await call()
    expect(res.status).toBe(403)
    expect(convert).not.toHaveBeenCalled()
  })

  it('switches, passing the baseball confirmation through only when it is literally true', async () => {
    signedInHeadAdmin()
    convert.mockResolvedValue({ kind: 'converted', conversionId: 'c' })
    expect((await call({ acceptWeeklyLineups: 'yes' })).status).toBe(200)
    expect(convert).toHaveBeenLastCalledWith({ marker: 'prisma' }, { leagueId: 'L', userId: 'u', acceptWeeklyLineups: false })
    await call({ acceptWeeklyLineups: true })
    expect(convert).toHaveBeenLastCalledWith({ marker: 'prisma' }, { leagueId: 'L', userId: 'u', acceptWeeklyLineups: true })
  })

  it('409s a refusal with its blockers', async () => {
    signedInHeadAdmin()
    convert.mockRejectedValue(new NativeConversionRefusal('2 things need fixing', [{ code: 'duplicate_copies' }]))
    const res = await call()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: '2 things need fixing', blockers: [{ code: 'duplicate_copies' }] })
  })

  it('500s with a plain message, not the internal error', async () => {
    signedInHeadAdmin()
    convert.mockRejectedValue(new Error('deadlock on 10.0.0.1'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('10.0.0.1')
  })
})
