import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_V2_STATE } from '@/lib/create-league-v2/state'
import { submitCreateLeagueV2 } from '@/lib/create-league-v2/submit'

afterEach(() => vi.unstubAllGlobals())

describe('create league submission contract', () => {
  it('a baseball league is created without any copy source or weekly-lineup flag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ leagueId: 'native-mlb' }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await submitCreateLeagueV2({ ...DEFAULT_V2_STATE, sport: 'MLB', leagueType: 'redraft', name: 'Baseball', scoringPresetId: 'mlb_h2h_5x5' })
    expect(result).toEqual({ ok: true, leagueId: 'native-mlb', redirectTo: expect.any(String) })
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body).not.toHaveProperty('sourceLeagueId')
    expect(body.conceptSetup ?? {}).not.toHaveProperty('acceptWeeklyLineups')
  })

  it.each([
    { sport: 'NFL', leagueType: 'dynasty', draftType: 'auction', concept: 'dynasty' },
    { sport: 'NBA', leagueType: 'best_ball', draftType: 'linear', concept: 'best_ball' },
    { sport: 'NCAAF', leagueType: 'redraft', draftType: 'snake', concept: 'idp', idpSelected: true },
  ] as const)('sends $sport $concept $draftType to canonical creation', async (selection) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ leagueId: 'created-league' }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await submitCreateLeagueV2({
      ...DEFAULT_V2_STATE,
      ...selection,
      name: 'Contract League',
      scoringPresetId: selection.sport === 'NBA' ? 'nba_points' : 'fb_half_ppr',
      draftDate: '2026-10-10',
      draftTime: '19:00',
    })

    expect(result.ok).toBe(true)
    expect(result.leagueId).toBe('created-league')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/leagues')
    const payload = JSON.parse(String(init.body))
    expect(payload).toMatchObject({
      sport: selection.sport,
      concept: selection.concept,
      draftType: selection.draftType,
      leagueName: 'Contract League',
    })
  })
})
