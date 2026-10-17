import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), standings: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: mocks.access }))
vi.mock('@/lib/big-brother/BigBrotherStandingsService', () => ({ getBigBrotherStandings: mocks.standings }))
import { GET } from '@/app/api/leagues/[leagueId]/big-brother/standings/route'
const request = () => GET(new Request('https://allfantasy.ai/api/leagues/l/big-brother/standings') as never, { params: Promise.resolve({ leagueId: 'l' }) })
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ user: { id: 'u' } }); mocks.access.mockResolvedValue({ ok: true }) })
describe('Big Brother standings authorization', () => {
  it('rejects anonymous viewers before any league queries', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await request()).status).toBe(401)
    expect(mocks.access).not.toHaveBeenCalled()
    expect(mocks.standings).not.toHaveBeenCalled()
  })
  it.each([403, 404])('returns %s without reading standings for inaccessible leagues', async status => {
    mocks.access.mockResolvedValue({ ok: false, status })
    expect((await request()).status).toBe(status)
    expect(mocks.standings).not.toHaveBeenCalled()
  })
  it('returns a private uncached member response', async () => {
    mocks.standings.mockResolvedValue({ leagueId: 'l', rows: [] })
    const response = await request()
    expect(response.status).toBe(200)
    expect(mocks.access).toHaveBeenCalledWith('l', 'u')
    expect(mocks.standings).toHaveBeenCalledWith('l', 'u')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ leagueId: 'l', rows: [] })
  })
  it('does not manufacture standings for another format', async () => {
    mocks.standings.mockResolvedValue(null)
    expect((await request()).status).toBe(404)
  })
  it('contains provider/database failures without exposing private diagnostics', async () => {
    mocks.standings.mockRejectedValue(new Error('private connection details'))
    const response = await request()
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('private connection')
  })
})
