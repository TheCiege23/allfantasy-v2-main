// @vitest-environment node
/**
 * `GET /api/core/player-card?impact=1` — the home exposure card's "if he sits" breakdown
 * rides the existing player-card route rather than a new one. It is the signed-in user's
 * own leagues, so it needs a session, and it never falls through to the public card.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSession = vi.fn()
const getPlayerLeagueImpact = vi.fn()
const getPlayerCard = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: () => ({ success: true, retryAfterSec: 0 }),
  buildRateLimit429: () => ({}),
  getClientIp: () => '127.0.0.1',
}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: vi.fn(async () => ({ ok: false })) }))
vi.mock('@/lib/core-app/playerCard', () => ({ getPlayerCard: (...a: unknown[]) => getPlayerCard(...a) }))
vi.mock('@/lib/core-app/playerLeagueImpact', () => ({
  getPlayerLeagueImpact: (...a: unknown[]) => getPlayerLeagueImpact(...a),
}))
/*
 * The card's player-depth paywall has its own suite (core-depth-paywall-routes). Pinned OPEN here so
 * this one does not change behaviour on launch day: unpinned, the real rule reads today's date, and
 * from Oct 15 the stub card below would be run through the locked filter — measured by forcing
 * AF_PAYWALL_STARTS_AT into the past, which turned "still serves the card" red.
 */
vi.mock('@/lib/core-app/corePaywall', () => ({
  resolveCoreDepth: vi.fn(async () => ({ depth: 'player_depth', unlocked: true, hasPlan: true, preLaunchFree: false })),
}))

import { GET } from '@/app/api/core/player-card/route'

const url = (q: string) => new Request(`http://localhost/api/core/player-card?${q}`)
const IMPACT = { playerId: '4046', rows: [], notPriced: 0 }

beforeEach(() => {
  getServerSession.mockReset()
  getPlayerLeagueImpact.mockReset()
  getPlayerCard.mockReset()
  getPlayerCard.mockResolvedValue({ card: true })
  getPlayerLeagueImpact.mockResolvedValue(IMPACT)
})

describe('player-card route, impact=1', () => {
  it('🛑 signed out gets 401 and no roster read', async () => {
    getServerSession.mockResolvedValue(null)
    const res = await GET(url('sport=NFL&sleeperId=4046&impact=1'))
    expect(res.status).toBe(401)
    expect(getPlayerLeagueImpact).not.toHaveBeenCalled()
    expect(getPlayerCard).not.toHaveBeenCalled()
  })

  it('🛑 reads only the SESSION user, whatever else the query carries', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'user-1' } })
    const res = await GET(url('sport=NFL&sleeperId=4046&impact=1&leagueId=someone-elses'))
    expect(res.status).toBe(200)
    expect(getPlayerLeagueImpact).toHaveBeenCalledWith({ userId: 'user-1', rosterPlayerId: '4046' })
    expect(await res.json()).toEqual({ impact: IMPACT })
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(getPlayerCard).not.toHaveBeenCalled()
  })

  it('needs the roster id, not only an externalId', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'user-1' } })
    const res = await GET(url('sport=NFL&externalId=abc&impact=1'))
    expect(res.status).toBe(400)
    expect(getPlayerLeagueImpact).not.toHaveBeenCalled()
  })

  it('a loader failure is a 503, not an empty breakdown', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'user-1' } })
    getPlayerLeagueImpact.mockRejectedValue(new Error('db down'))
    const res = await GET(url('sport=NFL&sleeperId=4046&impact=1'))
    expect(res.status).toBe(503)
  })

  it('without impact the route still serves the card', async () => {
    getServerSession.mockResolvedValue(null)
    const res = await GET(url('sport=NFL&sleeperId=4046'))
    expect(res.status).toBe(200)
    expect(getPlayerCard).toHaveBeenCalledTimes(1)
    expect(getPlayerLeagueImpact).not.toHaveBeenCalled()
  })

  it('any other impact value is rejected rather than ignored', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'user-1' } })
    const res = await GET(url('sport=NFL&sleeperId=4046&impact=true'))
    expect(res.status).toBe(400)
  })
})
