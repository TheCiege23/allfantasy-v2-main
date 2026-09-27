import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ session: vi.fn(), claimed: vi.fn(), owned: vi.fn(), trades: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueTeam: { findMany: m.claimed }, league: { findMany: m.owned }, leagueTrade: { findMany: m.trades } } }))
import { GET } from '@/app/api/core/trade-version/route'
beforeEach(() => { vi.clearAllMocks(); m.session.mockResolvedValue({ user: { id: 'viewer' } }); m.claimed.mockResolvedValue([{ league: { platformLeagueId: 'claimed-source' } }]); m.owned.mockResolvedValue([{ platformLeagueId: 'owned-source' }]); m.trades.mockResolvedValue([]) })
describe('Home trade invalidation', () => {
  it('requires authentication before any portfolio reads', async () => { m.session.mockResolvedValue(null); expect((await GET()).status).toBe(401); expect(m.claimed).not.toHaveBeenCalled() })
  it('scopes trade reads to this viewer and changes when an ingested trade arrives', async () => {
    const before = await (await GET()).json()
    expect(m.claimed.mock.calls[0][0].where).toEqual({ claimedByUserId: 'viewer' })
    expect(m.owned.mock.calls[0][0].where).toEqual({ userId: 'viewer' })
    expect(m.trades.mock.calls[0][0].where.OR).toEqual([{ platform: 'sleeper', history: { sleeperLeagueId: 'owned-source' } }, { platform: 'sleeper', history: { sleeperLeagueId: 'claimed-source' } }])
    m.trades.mockResolvedValue([{ id: 'new-trade', tradeDate: new Date('2026-09-27') }])
    const after = await (await GET()).json()
    expect(after.version).not.toBe(before.version)
    expect(JSON.stringify(after)).not.toContain('new-trade')
  })
  it('does not invent a version on a database failure', async () => { m.trades.mockRejectedValue(new Error('offline')); expect((await GET()).status).toBe(503) })
})
