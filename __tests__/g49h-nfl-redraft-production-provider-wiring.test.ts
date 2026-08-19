import { describe, expect, it, vi } from 'vitest'
import {
  assertNoMonthToMonthProviderRequiredForRuntime,
  buildNflRedraftProductionProviderConfigOverrides,
  listNflRedraftExistingProviderIntegrations,
  resolveNflRedraftProductionProviderCapability,
  type NflRedraftProductionProviderAdapter,
  type NflRedraftProviderNodeId,
} from '@/lib/nfl-provider'

function adapter(
  providerId: NflRedraftProviderNodeId,
  data: Record<string, unknown> | null,
  options: {
    cacheUsed?: boolean
    fallbackUsed?: boolean
    terminal?: boolean
    warnings?: string[]
  } = {},
): NflRedraftProductionProviderAdapter {
  return async (request) => ({
    providerId,
    capability: request.capability,
    canonicalData: data,
    sourceTimestampIso: '2026-09-13T18:00:00.000Z',
    fetchedAtIso: '2026-09-13T18:01:00.000Z',
    freshnessStatus: options.cacheUsed ? 'stale' : data ? 'available' : 'missing',
    fallbackUsed: options.fallbackUsed ?? false,
    cacheUsed: options.cacheUsed ?? false,
    healthStatus: options.cacheUsed ? 'DEGRADED' : 'ACTIVE',
    warnings: options.warnings ?? [],
    terminal: options.terminal,
    realIntegration: true,
    integrationName: `${providerId}:test-adapter`,
  })
}

function expectNoLeak(value: unknown) {
  const text = JSON.stringify(value).toLowerCase()
  expect(text).not.toContain('rawproviderpayload')
  expect(text).not.toContain('providerpayload')
  expect(text).not.toContain('providerplayerid')
  expect(text).not.toContain('api_key')
  expect(text).not.toContain('secret')
}

describe('G49H NFL redraft production provider wiring', () => {
  it('documents existing production wrappers reused by the provider wiring', () => {
    const integrations = listNflRedraftExistingProviderIntegrations()
    expect(integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: 'rolling_insights', existingWrapper: expect.stringContaining('sports-live-scores-service') }),
        expect.objectContaining({ providerId: 'api_sports', existingWrapper: 'lib/api-sports.ts' }),
        expect.objectContaining({ providerId: 'fantasycalc', existingWrapper: expect.stringContaining('lib/fantasycalc-db.ts') }),
        expect.objectContaining({ providerId: 'openweather', existingWrapper: expect.stringContaining('lib/openweathermap.ts') }),
        expect.objectContaining({ providerId: 'sleeper', existingWrapper: 'lib/sleeper-client.ts' }),
        expect.objectContaining({ providerId: 'espn', existingWrapper: 'lib/espn-client.ts' }),
      ]),
    )
    expect(integrations.every((integration) => integration.realProductionIntegration)).toBe(true)
  })

  it('keeps runtime capabilities from requiring month-to-month providers', () => {
    expect(assertNoMonthToMonthProviderRequiredForRuntime()).toMatchObject({
      ok: true,
      checkedCapabilities: ['player_identity', 'schedule', 'live_stats', 'standings', 'league_import'],
    })
  })

  it('marks month-to-month enhancement providers expired when credentials are unavailable', () => {
    const overrides = buildNflRedraftProductionProviderConfigOverrides({})

    expect(overrides.rolling_insights).toMatchObject({ state: 'ACTIVE' })
    expect(overrides.api_sports).toMatchObject({ state: 'EXPIRED' })
    expect(overrides.clearsports).toMatchObject({ state: 'EXPIRED' })
    expect(overrides.openweather).toMatchObject({ state: 'EXPIRED' })
  })

  it('selects Rolling Insights as production backbone when canonical data is available', async () => {
    const result = await resolveNflRedraftProductionProviderCapability(
      {
        capability: 'player_identity',
        playerName: 'Bijan Robinson',
        teamAbbr: 'ATL',
      },
      {
        now: () => new Date('2026-09-13T18:02:00.000Z'),
        adapters: {
          rolling_insights: {
            player_identity: adapter('rolling_insights', {
              allFantasyPlayerId: 'af:nfl:rolling:b-rob',
              displayName: 'Bijan Robinson',
              teamAbbreviation: 'ATL',
              providerPlayerId: 'ri-123',
              rawProviderPayload: { secret: 'nope' },
            }),
          },
        },
      },
    )

    expect(result.selectedProvider).toBe('rolling_insights')
    expect(result.canonicalData).toEqual({
      allFantasyPlayerId: 'af:nfl:rolling:b-rob',
      displayName: 'Bijan Robinson',
      teamAbbreviation: 'ATL',
    })
    expect(result.trace).toMatchObject({
      providerUsed: 'rolling_insights',
      fallbackUsed: false,
      cacheUsed: false,
      freshnessStatus: 'available',
    })
    expectNoLeak(result.canonicalData)
  })

  it('falls back to API-Sports when Rolling is failed and policy allows enhancement data', async () => {
    const result = await resolveNflRedraftProductionProviderCapability(
      {
        capability: 'schedule',
        season: 2026,
        week: 3,
        teamAbbr: 'KC',
        configOverrides: {
          rolling_insights: { state: 'FAILED' },
          api_sports: { state: 'ACTIVE' },
        },
      },
      {
        adapters: {
          api_sports: {
            schedule: adapter('api_sports', {
              season: 2026,
              week: 3,
              opponent: 'LV',
              kickoffTimeIso: '2026-09-27T17:00:00.000Z',
            }, { fallbackUsed: true }),
          },
        },
      },
    )

    expect(result.selectedProvider).toBe('api_sports')
    expect(result.attempts[0]).toMatchObject({ providerId: 'rolling_insights', reason: 'state_failed' })
    expect(result.trace).toMatchObject({ providerUsed: 'api_sports', fallbackUsed: true })
    expect(result.canonicalData).toMatchObject({ season: 2026, week: 3, opponent: 'LV' })
  })

  it('uses canonical cache before hiding optional FantasyCalc valuation data', async () => {
    const result = await resolveNflRedraftProductionProviderCapability(
      {
        capability: 'fantasy_valuations',
        playerName: 'CeeDee Lamb',
        configOverrides: {
          fantasycalc: { state: 'FAILED' },
        },
      },
      {
        adapters: {
          canonical_cache: {
            fantasy_valuations: adapter('canonical_cache', {
              fantasyValuation: { value: 9200, redraftValue: 8800 },
            }, { cacheUsed: true, fallbackUsed: true }),
          },
          hidden: {
            fantasy_valuations: adapter('hidden', null, { terminal: true, fallbackUsed: true }),
          },
        },
      },
    )

    expect(result.selectedProvider).toBe('canonical_cache')
    expect(result.trace).toMatchObject({ cacheUsed: true, fallbackUsed: true, freshnessStatus: 'stale' })
    expect(result.canonicalData).toEqual({ fantasyValuation: { value: 9200, redraftValue: 8800 } })
  })

  it('hides optional weather when OpenWeather and cache are disconnected', async () => {
    const result = await resolveNflRedraftProductionProviderCapability(
      {
        capability: 'weather',
        teamAbbr: 'BUF',
        configOverrides: {
          openweather: { state: 'FAILED' },
          canonical_cache: { state: 'FAILED' },
        },
      },
      {
        adapters: {
          hidden: {
            weather: adapter('hidden', null, { terminal: true, fallbackUsed: true }),
          },
        },
      },
    )

    expect(result.selectedProvider).toBe('hidden')
    expect(result.canonicalData).toBeNull()
    expect(result.trace).toMatchObject({ providerUsed: 'hidden', fallbackUsed: true, freshnessStatus: 'missing' })
  })

  it('falls back from TheSportsDB media to default avatar without breaking surfaces', async () => {
    const result = await resolveNflRedraftProductionProviderCapability(
      {
        capability: 'headshots',
        playerName: 'Amon-Ra St. Brown',
        configOverrides: {
          thesportsdb: { state: 'FAILED' },
          api_sports: { state: 'FAILED' },
          rolling_insights: { state: 'FAILED' },
        },
      },
      {
        adapters: {
          default_avatar: {
            headshots: adapter('default_avatar', {
              headshotUrl: null,
              fallbackKind: 'generic-player',
            }, { terminal: true, fallbackUsed: true }),
          },
        },
      },
    )

    expect(result.selectedProvider).toBe('default_avatar')
    expect(result.canonicalData).toEqual({ headshotUrl: null, fallbackKind: 'generic-player' })
  })

  it('continues from thrown provider adapters to later fallback providers', async () => {
    const broken = vi.fn<NflRedraftProductionProviderAdapter>().mockRejectedValue(new Error('provider timeout'))
    const result = await resolveNflRedraftProductionProviderCapability(
      {
        capability: 'news',
        configOverrides: {
          api_sports: { state: 'ACTIVE' },
        },
      },
      {
        adapters: {
          api_sports: { news: broken },
          canonical_cache: {
            news: adapter('canonical_cache', { latestNews: 'Practice report available' }, { cacheUsed: true, fallbackUsed: true }),
          },
        },
      },
    )

    expect(broken).toHaveBeenCalledTimes(1)
    expect(result.selectedProvider).toBe('canonical_cache')
    expect(result.attempts[0]).toMatchObject({
      providerId: 'api_sports',
      reason: 'adapter_error',
      error: 'provider timeout',
    })
    expect(result.warnings).toContain('api_sports:adapter_error')
  })

  it('preserves Sleeper then ESPN as import-only providers', async () => {
    const result = await resolveNflRedraftProductionProviderCapability(
      {
        capability: 'league_import',
        leagueImportId: '12345',
        configOverrides: {
          sleeper: { state: 'FAILED' },
          espn: { state: 'ACTIVE' },
        },
      },
      {
        adapters: {
          espn: {
            league_import: adapter('espn', {
              importProvider: 'espn',
              leagueName: 'Office League',
              teams: 12,
            }, { fallbackUsed: true }),
          },
        },
      },
    )

    expect(result.fallbackChain).toEqual(['sleeper', 'espn'])
    expect(result.selectedProvider).toBe('espn')
    expect(result.canonicalData).toEqual({ leagueName: 'Office League', teams: 12 })
  })
})
