import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), schedule: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: mocks.access }))
vi.mock('@/lib/big-brother/BigBrotherScheduleService', () => ({ getBigBrotherSchedule: mocks.schedule }))
import { GET } from '@/app/api/leagues/[leagueId]/big-brother/schedule/route'
const request = () => GET(new Request('https://allfantasy.ai/api/leagues/l/big-brother/schedule') as never, { params: Promise.resolve({ leagueId: 'l' }) })
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ user: { id: 'u' } }); mocks.access.mockResolvedValue({ ok: true, access: { isCommissioner: true } }) })
describe('Big Brother schedule authorization', () => {
  it('rejects anonymous viewers before any league queries', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await request()).status).toBe(401)
    expect(mocks.access).not.toHaveBeenCalled()
    expect(mocks.schedule).not.toHaveBeenCalled()
  })
  it.each([403, 404])('returns %s without reading schedule for inaccessible leagues', async status => {
    mocks.access.mockResolvedValue({ ok: false, status })
    expect((await request()).status).toBe(status)
    expect(mocks.schedule).not.toHaveBeenCalled()
  })
  it('returns a private uncached member response', async () => {
    mocks.schedule.mockResolvedValue({ leagueId: 'l', weeks: [] })
    const response = await request()
    expect(response.status).toBe(200)
    expect(mocks.access).toHaveBeenCalledWith('l', 'u')
    expect(mocks.schedule).toHaveBeenCalledWith('l')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ leagueId: 'l', weeks: [], isCommissioner: true })
  })
  it('does not manufacture schedule for another format', async () => {
    mocks.schedule.mockResolvedValue(null)
    expect((await request()).status).toBe(404)
  })
  it('contains provider/database failures without exposing private diagnostics', async () => {
    mocks.schedule.mockRejectedValue(new Error('private connection details'))
    const response = await request()
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('private connection')
  })
})
