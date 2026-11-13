// @vitest-environment node
/**
 * The guided import's "Test connection": league name + team count back, public/private detected
 * without the user choosing, cookies tested without being saved, and a wrong-season bare id
 * recovered instead of reported missing. `fetch` is injected; nothing here reaches ESPN.
 */
import { describe, expect, it, vi } from 'vitest'
import { testEspnLeagueConnection } from '@/lib/league-import/espn/EspnConnectionTestService'

const SWID = '{ABCD1234-EF56-7890-ABCD-1234567890AB}'
const S2 = `AEB${'k3Pq9ZtW1xYv%2B7mN0rLs'.repeat(14)}%3D%3D`
const NOV = new Date('2026-11-08T12:00:00Z')

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const league = (withOwner = false) => ({
  id: 123,
  seasonId: 2026,
  settings: { name: 'Sunday Funday', size: 10 },
  teams: Array.from({ length: 10 }, (_, i) => ({
    id: i + 1,
    location: 'Team',
    nickname: String(i + 1),
    owners: withOwner && i === 2 ? [SWID] : [`{0000000${i}-0000-0000-0000-000000000000}`],
  })),
})

const sleep = async () => {}

describe('testEspnLeagueConnection', () => {
  it('reads a public league and reports name, team count, and that import still needs ESPN connected', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(league()))
    const result = await testEspnLeagueConnection({ input: '123', now: NOV, fetchOptions: { fetchImpl, sleep } })
    expect(result).toMatchObject({
      ok: true,
      access: 'public',
      leagueName: 'Sunday Funday',
      teamCount: 10,
      season: 2026,
      viewerTeamFound: null,
      needsCookiesToImport: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('moves to the private step on 401 instead of erroring', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ messages: ['unauthorized'] }, 401))
    const result = await testEspnLeagueConnection({ input: '123', now: NOV, fetchOptions: { fetchImpl, sleep } })
    expect(result).toMatchObject({ ok: false, reason: 'needs_cookies', leagueId: '123' })
  })

  it('opens a private league with pasted cookies and finds the viewer team', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json(league(true)))
    const result = await testEspnLeagueConnection({
      input: 'https://fantasy.espn.com/football/league?leagueId=123&seasonId=2026',
      pastedCredentials: { swid: SWID, espnS2: S2 },
      now: NOV,
      fetchOptions: { fetchImpl, sleep },
    })
    expect(result).toMatchObject({
      ok: true,
      access: 'private',
      cookiesVerified: true,
      viewerTeamFound: true,
      viewerTeamName: 'Team 3',
      usedSavedCookies: false,
      needsCookiesToImport: false,
    })
    // The result object never carries the cookies.
    expect(JSON.stringify(result)).not.toContain(S2)
    expect(JSON.stringify(result)).not.toContain('ABCD1234')
  })

  it('says saved cookies have expired when ESPN refuses them', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({}, 401))
    const result = await testEspnLeagueConnection({
      input: '2026:123',
      savedCredentials: { swid: SWID, espnS2: S2 },
      now: NOV,
      fetchOptions: { fetchImpl, sleep },
    })
    expect(result).toMatchObject({ ok: false, reason: 'cookies_rejected', usedSavedCookies: true })
    expect((result as { message: string }).message).toMatch(/expired/)
  })

  it('retries the adjacent season for a bare id before saying "not found"', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({}, 404)).mockResolvedValueOnce(json({ ...league(), seasonId: 2025 }))
    const result = await testEspnLeagueConnection({ input: '123', now: NOV, fetchOptions: { fetchImpl, sleep } })
    expect(result).toMatchObject({ ok: true, season: 2025 })
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/seasons/2026/')
    expect(String(fetchImpl.mock.calls[1][0])).toContain('/seasons/2025/')
  })

  it('names both seasons when neither exists', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({}, 404))
    const result = await testEspnLeagueConnection({ input: '123', now: NOV, fetchOptions: { fetchImpl, sleep } })
    expect(result).toMatchObject({ ok: false, reason: 'not_found' })
    expect((result as { message: string }).message).toMatch(/2026 or 2025/)
  })

  it('returns a friendly invalid-input answer without calling ESPN', async () => {
    const fetchImpl = vi.fn()
    const result = await testEspnLeagueConnection({ input: 'my league', fetchOptions: { fetchImpl, sleep } })
    expect(result).toMatchObject({ ok: false, reason: 'invalid_input' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports ESPN outages as temporarily unavailable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({}, 503))
    const result = await testEspnLeagueConnection({ input: '2026:123', fetchOptions: { fetchImpl, sleep } })
    expect(result).toMatchObject({ ok: false, reason: 'unavailable' })
    expect((result as { message: string }).message).toMatch(/temporarily unavailable/)
  })
})
