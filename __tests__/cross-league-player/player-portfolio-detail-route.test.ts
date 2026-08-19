/**
 * Cross-League Player Intelligence phase — Part 11 + Part 20 tests: player
 * detail API and the player-ID-probing rejection it must guarantee.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireAuthMock, assembleMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn(), assembleMock: vi.fn() }))

vi.mock('@/lib/auth-guard', () => ({ requireAuth: requireAuthMock }))
vi.mock('@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio', () => ({ assembleCrossLeaguePlayerPortfolio: assembleMock }))

function makeParams(canonicalPlayerId: string) {
  return { params: Promise.resolve({ canonicalPlayerId }) }
}

describe('GET /api/player-portfolio/[canonicalPlayerId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    requireAuthMock.mockResolvedValue({ ok: false, response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) })
    const { GET } = await import('@/app/api/player-portfolio/[canonicalPlayerId]/route')
    const res = await GET(new Request('http://localhost/api/player-portfolio/p1'), makeParams('p1'))
    expect(res.status).toBe(401)
    expect(assembleMock).not.toHaveBeenCalled()
  })

  it('returns the real item when the caller genuinely rosters this player', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'real-user' })
    assembleMock.mockResolvedValue({ items: [{ canonicalPlayerId: 'p1', displayName: 'Player One' }], connectedLeagueCount: 1, unsupportedSports: [] })
    const { GET } = await import('@/app/api/player-portfolio/[canonicalPlayerId]/route')
    const res = await GET(new Request('http://localhost/api/player-portfolio/p1'), makeParams('p1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.item.canonicalPlayerId).toBe('p1')
  })

  it('player-ID probing: a canonical id the caller does not roster returns 404, never another user\'s data', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'attacker' })
    // The attacker's OWN portfolio genuinely doesn't include this player — the route never queries
    // for "who owns player X" independently, only searches within the caller's own authorized set.
    assembleMock.mockResolvedValue({ items: [{ canonicalPlayerId: 'some-other-player' }], connectedLeagueCount: 1, unsupportedSports: [] })
    const { GET } = await import('@/app/api/player-portfolio/[canonicalPlayerId]/route')
    const res = await GET(new Request('http://localhost/api/player-portfolio/victim-owned-player'), makeParams('victim-owned-player'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).not.toHaveProperty('item')
  })

  it('a genuinely nonexistent canonical id resolves to the SAME 404 shape as a probed-but-inaccessible one', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'real-user' })
    assembleMock.mockResolvedValue({ items: [], connectedLeagueCount: 0, unsupportedSports: [] })
    const { GET } = await import('@/app/api/player-portfolio/[canonicalPlayerId]/route')
    const res = await GET(new Request('http://localhost/api/player-portfolio/nonexistent-xyz'), makeParams('nonexistent-xyz'))
    expect(res.status).toBe(404)
  })

  it('never calls assembleCrossLeaguePlayerPortfolio with anything other than the session-derived appUserId', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'real-user' })
    assembleMock.mockResolvedValue({ items: [], connectedLeagueCount: 0, unsupportedSports: [] })
    const { GET } = await import('@/app/api/player-portfolio/[canonicalPlayerId]/route')
    await GET(new Request('http://localhost/api/player-portfolio/p1'), makeParams('p1'))
    expect(assembleMock).toHaveBeenCalledWith({ appUserId: 'real-user' })
  })

  it('returns 400 without a canonicalPlayerId', async () => {
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'real-user' })
    const { GET } = await import('@/app/api/player-portfolio/[canonicalPlayerId]/route')
    const res = await GET(new Request('http://localhost/api/player-portfolio/'), makeParams(''))
    expect(res.status).toBe(400)
  })
})
