/**
 * Client-helper boundary test for the NFL redraft playoff UI wiring.
 *
 * The nflRedraftCore Standings tab could Generate + Finalize but had no way to
 * ADVANCE a playoff round (no client helper, no route call). This locks the new
 * `advancePlayoffRound` helper to the EXISTING advance route
 * (`POST /api/redraft/playoffs/advance`) — no new endpoint, no second system.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { advancePlayoffRound } from '@/lib/redraft/client'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('advancePlayoffRound client helper', () => {
  it('POSTs { seasonId, week } to the existing /api/redraft/playoffs/advance route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ seasonId: 's1', week: 15, advanced: 2, skipped: 0, blocked: [], status: 'round_complete' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await advancePlayoffRound({ seasonId: 's1', week: 15 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/redraft/playoffs/advance')
    expect(opts.method).toBe('POST')
    expect(opts.credentials).toBe('include')
    expect(JSON.parse(String(opts.body))).toEqual({ seasonId: 's1', week: 15 })
    expect(res.status).toBe('round_complete')
    expect(res.advanced).toBe(2)
  })

  it('surfaces the route error message on a non-ok response (no silent swallow)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'not_nfl_redraft' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(advancePlayoffRound({ seasonId: 's1', week: 15 })).rejects.toThrow('not_nfl_redraft')
  })
})
