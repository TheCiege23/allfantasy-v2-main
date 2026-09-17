// @vitest-environment node
/**
 * `/api/core/player-card/watch` — a body WITHOUT leagueId is a cross-league follow
 * (2026-09-14); a body WITH leagueId is the league watchlist, unchanged. No new route.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSession = vi.fn()
const resolveLeagueMembership = vi.fn()
const addToWatchlist = vi.fn()
const removeFromWatchlist = vi.fn()
const findFirst = vi.fn()
const followPlayer = vi.fn()
const unfollowPlayer = vi.fn()
const setTradeBlock = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: () => ({ success: true, retryAfterSec: 0 }),
  buildRateLimit429: () => ({}),
  getClientIp: () => '127.0.0.1',
}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: (...a: unknown[]) => resolveLeagueMembership(...a) }))
vi.mock('@/lib/waiver-wire/watchlist-service', () => ({
  addToWatchlist: (...a: unknown[]) => addToWatchlist(...a),
  removeFromWatchlist: (...a: unknown[]) => removeFromWatchlist(...a),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsPlayer: { findFirst: (...a: unknown[]) => findFirst(...a) } } }))
vi.mock('@/lib/follows/playerFollows', () => ({
  followKeyFor: (p: { sleeperId?: string | null; externalId?: string | null }) => p.sleeperId || p.externalId || null,
  followPlayer: (...a: unknown[]) => followPlayer(...a),
  unfollowPlayer: (...a: unknown[]) => unfollowPlayer(...a),
}))

vi.mock('@/lib/trade-block/importedTradeBlock', () => ({
  setTradeBlock: (...a: unknown[]) => setTradeBlock(...a),
}))

import { DELETE, POST } from '@/app/api/core/player-card/watch/route'

const req = (method: string, body: unknown) =>
  new Request('http://localhost/api/core/player-card/watch', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const ROW = { externalId: 'ri:771', sleeperId: '9221', sport: 'NFL', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET' }

beforeEach(() => {
  for (const f of [getServerSession, resolveLeagueMembership, addToWatchlist, removeFromWatchlist, findFirst, followPlayer, unfollowPlayer, setTradeBlock]) {
    f.mockReset()
  }
  getServerSession.mockResolvedValue({ user: { id: 'u1' } })
  findFirst.mockResolvedValue(ROW)
  followPlayer.mockResolvedValue('followed')
  unfollowPlayer.mockResolvedValue('unfollowed')
})

describe('follow (no leagueId)', () => {
  it('🛑 signed out is 401 and writes nothing', async () => {
    getServerSession.mockResolvedValue(null)
    const res = await POST(req('POST', { sport: 'NFL', sleeperId: '9221' }))
    expect(res.status).toBe(401)
    expect(followPlayer).not.toHaveBeenCalled()
  })

  it('🛑 the snapshot is OUR player row, never the request — and no membership check', async () => {
    const res = await POST(req('POST', { sport: 'NFL', sleeperId: '9221', name: 'Someone Invented' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, following: true })
    expect(followPlayer).toHaveBeenCalledWith('u1', {
      sport: 'NFL',
      externalId: 'ri:771',
      sleeperId: '9221',
      name: 'Jahmyr Gibbs',
      position: 'RB',
      team: 'DET',
    })
    expect(resolveLeagueMembership).not.toHaveBeenCalled()
    expect(addToWatchlist).not.toHaveBeenCalled()
  })

  it('an unknown player is 404', async () => {
    findFirst.mockResolvedValue(null)
    const res = await POST(req('POST', { sport: 'NFL', sleeperId: 'nope' }))
    expect(res.status).toBe(404)
    expect(followPlayer).not.toHaveBeenCalled()
  })

  it('at the limit is 409; follows unavailable is 503', async () => {
    followPlayer.mockResolvedValueOnce('limit').mockResolvedValueOnce('unavailable')
    expect((await POST(req('POST', { sport: 'NFL', sleeperId: '9221' }))).status).toBe(409)
    expect((await POST(req('POST', { sport: 'NFL', sleeperId: '9221' }))).status).toBe(503)
  })

  it('needs an id', async () => {
    const res = await POST(req('POST', { sport: 'NFL' }))
    expect(res.status).toBe(400)
  })

  it('DELETE unfollows under the row’s key even when only the externalId was sent', async () => {
    const res = await DELETE(req('DELETE', { sport: 'NFL', externalId: 'ri:771' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, following: false })
    expect(unfollowPlayer).toHaveBeenCalledWith('u1', 'NFL', '9221')
  })
})

describe('league watchlist (leagueId present) — unchanged', () => {
  it('🛑 still membership-gated and written through the watchlist service', async () => {
    resolveLeagueMembership.mockResolvedValue({ ok: true })
    const res = await POST(req('POST', { leagueId: 'lg-42', sleeperId: '9221', sport: 'NFL' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, watched: true })
    expect(resolveLeagueMembership).toHaveBeenCalledWith('lg-42', 'u1')
    expect(addToWatchlist).toHaveBeenCalledWith('lg-42', 'u1', '9221', 'NFL')
    expect(followPlayer).not.toHaveBeenCalled()
  })

  it('a non-member still gets the league’s own status', async () => {
    resolveLeagueMembership.mockResolvedValue({ ok: false, status: 404 })
    const res = await DELETE(req('DELETE', { leagueId: 'lg-42', sleeperId: '9221' }))
    expect(res.status).toBe(404)
    expect(removeFromWatchlist).not.toHaveBeenCalled()
  })
})

/*
 * The trade block rides the same route (no new route): `list: 'trade-block'` on a league body.
 * Membership is checked here; that the player is YOURS is proved by the service, and its refusals
 * come back with their own status and wording.
 */
describe('trade block (leagueId + list: trade-block)', () => {
  beforeEach(() => {
    resolveLeagueMembership.mockResolvedValue({ ok: true })
    setTradeBlock.mockResolvedValue({ ok: true, onBlock: true })
  })

  it('POST puts him on the block and touches neither the watchlist nor follows', async () => {
    const res = await POST(req('POST', { leagueId: 'lg-42', sleeperId: '9221', sport: 'NFL', list: 'trade-block' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, onTradeBlock: true })
    expect(resolveLeagueMembership).toHaveBeenCalledWith('lg-42', 'u1')
    expect(setTradeBlock).toHaveBeenCalledWith({ leagueId: 'lg-42', userId: 'u1', sleeperId: '9221', onBlock: true })
    expect(addToWatchlist).not.toHaveBeenCalled()
    expect(followPlayer).not.toHaveBeenCalled()
  })

  it('DELETE takes him off', async () => {
    setTradeBlock.mockResolvedValue({ ok: true, onBlock: false })
    const res = await DELETE(req('DELETE', { leagueId: 'lg-42', sleeperId: '9221', list: 'trade-block' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, onTradeBlock: false })
    expect(setTradeBlock).toHaveBeenCalledWith({ leagueId: 'lg-42', userId: 'u1', sleeperId: '9221', onBlock: false })
    expect(removeFromWatchlist).not.toHaveBeenCalled()
  })

  it('🛑 a non-member is refused before the service is asked', async () => {
    resolveLeagueMembership.mockResolvedValue({ ok: false, status: 404 })
    const res = await POST(req('POST', { leagueId: 'lg-42', sleeperId: '9221', list: 'trade-block' }))
    expect(res.status).toBe(404)
    expect(setTradeBlock).not.toHaveBeenCalled()
  })

  it('🛑 signed out is 401 and writes nothing', async () => {
    getServerSession.mockResolvedValue(null)
    const res = await POST(req('POST', { leagueId: 'lg-42', sleeperId: '9221', list: 'trade-block' }))
    expect(res.status).toBe(401)
    expect(setTradeBlock).not.toHaveBeenCalled()
  })

  it.each([
    ['not_your_player', 403],
    ['no_team', 403],
    ['unsupported_platform', 400],
    ['league_not_found', 404],
    ['no_roster_id', 409],
  ] as const)('a %s refusal is %i with the service message', async (reason, status) => {
    setTradeBlock.mockResolvedValue({ ok: false, reason, message: `because ${reason}` })
    const res = await POST(req('POST', { leagueId: 'lg-42', sleeperId: '9221', list: 'trade-block' }))
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: `because ${reason}`, code: reason })
  })

  it('an unknown list is a bad request, not a watchlist write', async () => {
    const res = await POST(req('POST', { leagueId: 'lg-42', sleeperId: '9221', list: 'favourites' }))
    expect(res.status).toBe(400)
    expect(addToWatchlist).not.toHaveBeenCalled()
    expect(setTradeBlock).not.toHaveBeenCalled()
  })

  it('an explicit watchlist list is the watchlist', async () => {
    const res = await POST(req('POST', { leagueId: 'lg-42', sleeperId: '9221', list: 'watchlist' }))
    expect(await res.json()).toEqual({ ok: true, watched: true })
    expect(setTradeBlock).not.toHaveBeenCalled()
  })
})
