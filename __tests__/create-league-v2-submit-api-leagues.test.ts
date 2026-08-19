import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { submitCreateLeagueV2 } from '@/lib/create-league-v2/submit'
import { DEFAULT_V2_STATE, type CreateLeagueV2State } from '@/lib/create-league-v2/state'

function mockFetchSuccess(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        league: { id: 'test-league-id' },
        homepageUrl: '/league/test-league-id?created=1',
        ...overrides,
      }),
    } as Response),
  )
}

function state(overrides: Partial<CreateLeagueV2State>): CreateLeagueV2State {
  return {
    ...DEFAULT_V2_STATE,
    leagueType: 'redraft',
    idpSelected: false,
    sport: 'NFL',
    soccerPipeline: null,
    scoringPresetId: 'fb_half_ppr',
    teamCount: 12,
    draftType: 'snake',
    draftDate: '2026-08-30',
    draftTime: '20:00',
    privacy: 'private',
    survivorTribeCount: 2,
    name: 'Unit Test League',
    nameTouched: true,
    ...overrides,
  }
}

function lastFetchBody(): Record<string, unknown> {
  const fetchMock = vi.mocked(fetch)
  expect(fetchMock).toHaveBeenCalled()
  const init = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]?.[1] as RequestInit | undefined
  const raw = init?.body
  if (typeof raw !== 'string') throw new Error('Expected JSON body string')
  return JSON.parse(raw) as Record<string, unknown>
}

describe('submitCreateLeagueV2 → /api/leagues', () => {
  beforeEach(() => {
    mockFetchSuccess()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('POSTs /api/leagues with canonical body keys for redraft', async () => {
    const result = await submitCreateLeagueV2(state({ leagueType: 'redraft' }))
    expect(result.ok).toBe(true)

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('/api/leagues')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)?.['Content-Type']).toBe('application/json')

    const body = lastFetchBody()
    expect(body).toMatchObject({
      concept: 'redraft',
      sport: 'NFL',
      scoringPreset: 'fb_half_ppr',
      teamCount: 12,
      draftType: 'snake',
      leagueName: 'Unit Test League',
      timezone: 'America/New_York',
      language: 'en',
      tradeReviewMode: 'commissioner',
    })
    expect(body).not.toHaveProperty('userId')
    expect(body).not.toHaveProperty('commissionerId')
    expect(body.conceptSetup).toMatchObject({
      visibility: 'private',
      isPublic: false,
      draftDate: '2026-08-30',
      draftTime: '20:00',
      draftTimezone: 'America/New_York',
    })
  })

  it('uses concept idp when IDP card is selected', async () => {
    await submitCreateLeagueV2(
      state({
        leagueType: 'redraft',
        idpSelected: true,
        sport: 'NFL',
        scoringPresetId: 'fb_idp_balanced',
      }),
    )

    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/leagues')
    expect(lastFetchBody().concept).toBe('idp')
  })

  it('includes keeper policy fields in conceptSetup for keeper leagues', async () => {
    await submitCreateLeagueV2(
      state({
        leagueType: 'keeper',
        scoringPresetId: 'fb_half_ppr',
        keeper: {
          keeperMaxKeepers: 4,
          keeperMaxYears: 2,
          keeperRoundPenalty: 2,
          keeperWaiverAllowed: false,
          keeperEligibilityRule: 'drafted_only',
          introVideoUrl: '/custom-keeper.mp4',
          introPosterUrl: '/custom-keeper.png',
        },
      }),
    )

    const body = lastFetchBody()
    expect(body.concept).toBe('keeper')
    expect(body.conceptSetup).toMatchObject({
      keeper_max_keepers: 4,
      keeperMaxKeepers: 4,
      keeper_max_years: 2,
      keeper_round_penalty: 2,
      keeper_waiver_allowed: false,
      keeper_eligibility_rule: 'drafted_only',
      introVideoUrl: '/custom-keeper.mp4',
      introPosterUrl: '/custom-keeper.png',
    })
  })

  it('includes survivorTribeCount in conceptSetup for survivor', async () => {
    await submitCreateLeagueV2(
      state({
        leagueType: 'survivor',
        teamCount: 16,
        scoringPresetId: 'fb_half_ppr',
        survivorTribeCount: 4,
      }),
    )

    const body = lastFetchBody()
    expect(body.concept).toBe('survivor')
    expect(body.conceptSetup).toMatchObject({
      survivorTribeCount: 4,
      visibility: 'private',
      draftDate: '2026-08-30',
      draftTime: '20:00',
    })
  })

  it('sends soccerPipeline for SOCCER', async () => {
    await submitCreateLeagueV2(
      state({
        leagueType: 'redraft',
        sport: 'SOCCER',
        soccerPipeline: 'mls',
        teamCount: 12,
        scoringPresetId: 'soc_points_default',
      }),
    )

    expect(lastFetchBody()).toMatchObject({
      sport: 'SOCCER',
      soccerPipeline: 'mls',
    })
  })

  it('routes tournament to /api/tournament/create, not /api/leagues', async () => {
    await submitCreateLeagueV2(
      state({
        leagueType: 'tournament',
        teamCount: 64,
        scoringPresetId: 'fb_half_ppr',
      }),
    )

    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('/api/tournament/create')
    const body = lastFetchBody()
    expect(body).toHaveProperty('name')
    expect(body).toHaveProperty('sport')
    expect(body).toHaveProperty('settings')
    expect(body).not.toHaveProperty('concept')
  })

  it('maps devy snake → devy_snake and devy auction → devy_auction', async () => {
    await submitCreateLeagueV2(
      state({
        leagueType: 'devy',
        sport: 'NFL',
        draftType: 'snake',
        scoringPresetId: 'fb_half_ppr',
      }),
    )
    expect(lastFetchBody().draftType).toBe('devy_snake')

    vi.mocked(fetch).mockClear()
    mockFetchSuccess()

    await submitCreateLeagueV2(
      state({
        leagueType: 'devy',
        sport: 'NFL',
        draftType: 'auction',
        scoringPresetId: 'fb_half_ppr',
      }),
    )
    expect(lastFetchBody().draftType).toBe('devy_auction')
  })

  it('maps c2c snake → c2c_snake and c2c auction → c2c_auction', async () => {
    await submitCreateLeagueV2(
      state({
        leagueType: 'c2c',
        sport: 'NFL',
        draftType: 'snake',
        scoringPresetId: 'fb_half_ppr',
      }),
    )
    expect(lastFetchBody().draftType).toBe('c2c_snake')

    vi.mocked(fetch).mockClear()
    mockFetchSuccess()

    await submitCreateLeagueV2(
      state({
        leagueType: 'c2c',
        sport: 'NFL',
        draftType: 'auction',
        scoringPresetId: 'fb_half_ppr',
      }),
    )
    expect(lastFetchBody().draftType).toBe('c2c_auction')
  })

  it('keeps dynasty and redraft draft ids as snake (no devy/c2c prefix)', async () => {
    await submitCreateLeagueV2(
      state({
        leagueType: 'dynasty',
        draftType: 'snake',
        scoringPresetId: 'fb_half_ppr',
      }),
    )
    expect(lastFetchBody().draftType).toBe('snake')

    vi.mocked(fetch).mockClear()
    mockFetchSuccess()

    await submitCreateLeagueV2(
      state({
        leagueType: 'redraft',
        draftType: 'snake',
        scoringPresetId: 'fb_half_ppr',
      }),
    )
    expect(lastFetchBody().draftType).toBe('snake')
  })

  it('preserves offline for devy (execution mode) without remapping to devy_snake string', async () => {
    await submitCreateLeagueV2(
      state({
        leagueType: 'devy',
        sport: 'NFL',
        draftType: 'offline',
        scoringPresetId: 'fb_half_ppr',
      }),
    )
    expect(lastFetchBody().draftType).toBe('offline')
  })
})
