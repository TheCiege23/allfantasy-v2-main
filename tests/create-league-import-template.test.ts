import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStateFromImportedLeague } from '@/lib/create-league-v2/import-template'
import { analyzeCreateLeagueCompletion } from '@/lib/create-league-v2/form-completion'
import { submitCreateLeagueV2 } from '@/lib/create-league-v2/submit'

afterEach(() => vi.unstubAllGlobals())

describe('standalone league setup from an import', () => {
  it('keeps supported setup choices and requires a new draft schedule', () => {
    const state = createStateFromImportedLeague({
      name: 'Friday Dynasty',
      sport: 'NFL',
      leagueType: 'dynasty',
      leagueVariant: null,
      leagueSize: 16,
      scoringPresetId: 'fb_ppr',
      draftType: 'auction',
    })

    expect(state).toMatchObject({
      name: 'Friday Dynasty on AllFantasy',
      sport: 'NFL',
      leagueType: 'dynasty',
      teamCount: 16,
      scoringPresetId: 'fb_ppr',
      draftType: 'auction',
      draftDate: '',
      draftTime: '',
    })
    expect(state.dynasty.playoffTeamCount).toBeLessThanOrEqual(state.teamCount)
    expect(analyzeCreateLeagueCompletion(state).map(({ code }) => code)).toEqual([
      'draft_date_required',
      'draft_time_required',
    ])
  })

  it('normalizes an unsupported source combination to valid native choices', () => {
    const state = createStateFromImportedLeague({
      name: 'College League',
      sport: 'NCAAB',
      leagueType: 'guillotine',
      leagueVariant: null,
      leagueSize: 300,
      scoringPresetId: 'unknown-provider-preset',
      draftType: 'auto',
    })

    expect(state.sport).toBe('NCAAB')
    expect(state.leagueType).toBe('redraft')
    expect(state.teamCount).toBeGreaterThan(1)
    expect(state.scoringPresetId).not.toBe('unknown-provider-preset')
  })

  it('preserves an imported IDP choice as a native IDP league', () => {
    const state = createStateFromImportedLeague({
      name: 'Defensive League',
      sport: 'NCAAF',
      leagueType: 'redraft',
      leagueVariant: 'dynasty_idp',
      leagueSize: 12,
      scoringPresetId: null,
      draftType: 'snake',
    })

    expect(state.idpSelected).toBe(true)
    expect(state.leagueType).toBe('redraft')
    expect(state.scoringPresetId).toBeTruthy()
  })

  it('submits the template through native creation without a provider link', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ leagueId: 'native-1' }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const state = createStateFromImportedLeague({
      name: 'Imported Hoops',
      sport: 'NBA',
      leagueType: 'redraft',
      leagueVariant: null,
      leagueSize: 10,
      scoringPresetId: 'nba_points',
      draftType: 'snake',
    })
    const result = await submitCreateLeagueV2({ ...state, draftDate: '2026-10-10', draftTime: '19:00' })

    expect(result.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/leagues')
    const payload = JSON.parse(String(init.body))
    expect(payload).toMatchObject({ sport: 'NBA', concept: 'redraft', teamCount: 10, draftType: 'snake' })
    expect(payload).not.toHaveProperty('provider')
    expect(payload).not.toHaveProperty('sourceLeagueId')
  })
})
