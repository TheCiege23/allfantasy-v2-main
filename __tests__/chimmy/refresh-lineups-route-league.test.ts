// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * POST /api/core/players/refresh-lineups takes an optional { leagueId } (Chimmy's "Refresh league
 * data"). The Player Finder posts no body and keeps refreshing every claimed league.
 */
const h = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: vi.fn(async () => ({ ok: true, userId: 'me' })) }))
vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: vi.fn(() => ({ success: true })), buildRateLimit429: vi.fn() }))
vi.mock('@/lib/import-os/collector/lineupRefresh', () => ({ refreshLineupsNow: h.refresh }))

import { POST } from '@/app/api/core/players/refresh-lineups/route'

const req = (body?: string) =>
  new Request('http://localhost/api/core/players/refresh-lineups', { method: 'POST', ...(body !== undefined ? { body, headers: { 'content-type': 'application/json' } } : {}) })

beforeEach(() => {
  h.refresh.mockReset().mockResolvedValue({ total: 1, attempted: [{ runKey: 'k', provider: 'sleeper', status: 'refreshed' }], remaining: 0 })
})

describe('refresh-lineups route — one league', () => {
  it('passes a named league through', async () => {
    const res = await POST(req(JSON.stringify({ leagueId: 'af-league-1' })))
    expect(h.refresh).toHaveBeenCalledWith({ userId: 'me', leagueId: 'af-league-1' })
    expect(await res.json()).toMatchObject({ refreshed: 1, remaining: 0 })
  })

  it('no body (the Player Finder) refreshes every claimed league, as before', async () => {
    await POST(req())
    expect(h.refresh).toHaveBeenCalledWith({ userId: 'me', leagueId: null })
  })

  it('ignores anything that is not a plain short id, rather than passing it on', async () => {
    for (const body of ['{"leagueId":{"in":["a","b"]}}', '{"leagueId":"a b; drop"}', `{"leagueId":"${'x'.repeat(65)}"}`, 'not json']) {
      h.refresh.mockClear()
      await POST(req(body))
      expect(h.refresh).toHaveBeenCalledWith({ userId: 'me', leagueId: null })
    }
  })
})
