import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ player: vi.fn(), players: vi.fn(), highlights: vi.fn(), limit: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsPlayer: { findFirst: mocks.player, findMany: mocks.players } } }))
vi.mock('@/lib/highlights/youtube', () => ({ getPlayerHighlights: mocks.highlights }))
vi.mock('@/lib/rate-limit', () => ({
  getClientIp: () => '127.0.0.1', consumeRateLimit: mocks.limit,
  buildRateLimit429: () => ({ error: 'Rate limited' }),
}))
import { GET } from '@/app/api/core/player-card/highlights/route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.limit.mockReturnValue({ success: true })
  mocks.player.mockResolvedValue({ sport: 'NFL', name: 'Josh Allen', team: 'BUF' })
  mocks.players.mockResolvedValue([{ sport: 'NFL', name: 'Josh Allen', team: 'BUF', position: 'QB', source: 'sleeper', sleeperId: '123', fetchedAt: new Date() }])
  mocks.highlights.mockResolvedValue({ status: 'ready', videos: [], message: 'No highlights', checkedAt: null })
})
const request = (params: string) => new Request(`https://allfantasy.ai/api/core/player-card/highlights?${params}`)

describe('public player highlights route', () => {
  it('requires canonical identity and never sends caller names to YouTube', async () => {
    expect((await GET(request('sport=NFL&name=Josh+Allen'))).status).toBe(400)
    const response = await GET(request('sport=nfl&externalId=ri%3A123&name=Someone+Else'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mocks.highlights).toHaveBeenCalledWith({ sport: 'NFL', name: 'Josh Allen', team: 'BUF' })
    expect(mocks.player.mock.calls[0][0].where.externalId).toBe('ri:123')
  })
  it('supports Sleeper identities and handles missing players and DB failures', async () => {
    await GET(request('sport=NFL&sleeperId=123'))
    expect(mocks.players.mock.calls[0][0].where.sleeperId.equals).toBe('123')
    expect(mocks.highlights).toHaveBeenCalledWith({ sport: 'NFL', name: 'Josh Allen', team: 'BUF' })
    mocks.players.mockResolvedValueOnce([])
    expect((await GET(request('sport=NFL&sleeperId=unknown'))).status).toBe(404)
    mocks.players.mockRejectedValueOnce(new Error('database credential'))
    const failed = await GET(request('sport=NFL&sleeperId=123'))
    expect(failed.status).toBe(503)
    expect(await failed.text()).not.toContain('credential')
  })
  it('searches the Sleeper row for a Sleeper id, never a newer namesake row carrying it', async () => {
    // Production 2026-10-11: TheSportsDB's Seahawks DT carries the Vikings CB's Sleeper id 5864.
    mocks.players.mockResolvedValueOnce([
      { sport: 'NFL', name: 'Byron Murphy', team: 'Seattle Seahawks', position: 'DT', source: 'thesportsdb', sleeperId: '5864', fetchedAt: new Date('2026-10-11T08:42:36Z') },
      { sport: 'NFL', name: 'Byron Murphy', team: 'Minnesota Vikings', position: 'CB', source: 'sleeper', sleeperId: '5864', fetchedAt: new Date('2026-10-10T12:06:58Z') },
    ])
    expect((await GET(request('sport=NFL&sleeperId=5864'))).status).toBe(200)
    expect(mocks.highlights).toHaveBeenCalledWith({ sport: 'NFL', name: 'Byron Murphy', team: 'Minnesota Vikings' })
  })
  it('enforces rate limits before DB or provider work', async () => {
    mocks.limit.mockReturnValue({ success: false, retryAfterSec: 60 })
    const response = await GET(request('sport=NFL&sleeperId=123'))
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(mocks.player).not.toHaveBeenCalled()
    expect(mocks.players).not.toHaveBeenCalled()
    expect(mocks.highlights).not.toHaveBeenCalled()
  })
})
