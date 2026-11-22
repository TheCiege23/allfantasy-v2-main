/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), league: vi.fn(), native: vi.fn(), archives: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: h.access }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.league }, leagueSeason: { findMany: h.archives } } }))
vi.mock('@/lib/redraft/offseason/nativeSeasonHistory', () => ({ loadNativeSeasonHistory: h.native }))
import { GET as seasonHistory } from '@/app/api/league/[leagueId]/season-history/route'
import { GET as draftHistory } from '@/app/api/league/[leagueId]/draft-history/route'
const ctx = { params: Promise.resolve({ leagueId: 'l1' }) }
beforeEach(() => {
  vi.clearAllMocks()
  h.session.mockResolvedValue({ user: { id: 'manager' } })
  h.access.mockResolvedValue({ isMember: true })
  h.league.mockResolvedValue({ platform: 'allfantasy' })
  h.archives.mockResolvedValue([{ season: 2025 }])
  h.native.mockResolvedValue({ season: 2025, meta: { championName: 'Champion' }, draft: [{ draftId: 'old-draft', playerId: 'old-player' }] })
})
describe('native archived history endpoints', () => {
  it.each([seasonHistory, draftHistory])('refuses a signed-in outsider before reading archived data', async handler => {
    h.access.mockResolvedValue({ isMember: false })
    expect((await handler(new Request('http://localhost/api/history?season=2025'), ctx)).status).toBe(403)
    expect(h.native).not.toHaveBeenCalled()
    expect(h.archives).not.toHaveBeenCalled()
  })
  it('reads a requested native season rather than import-only facts', async () => {
    const response = await seasonHistory(new Request('http://localhost/api/history?season=2025'), ctx)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ season: 2025, meta: { championName: 'Champion' } })
    expect(h.native).toHaveBeenCalledWith('l1', 2025)
  })
  it('returns the archived native draft to the historical draft board', async () => {
    const response = await draftHistory(new Request('http://localhost/api/history?season=2025'), ctx)
    expect(await response.json()).toMatchObject({ seasons: [{ year: 2025, picks: [{ draftId: 'old-draft' }] }] })
  })
})
