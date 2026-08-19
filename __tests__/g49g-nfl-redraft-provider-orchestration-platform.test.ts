import { describe, expect, it } from 'vitest'
import {
  NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES,
  buildNflRedraftProviderHealthSummaries,
  getNflRedraftProviderFallbackOrder,
  mergeNflRedraftCanonicalProviderResults,
  selectNflRedraftProviderForCapability,
} from '@/lib/nfl-provider'

function expectNoCanonicalLeak(value: unknown) {
  const text = JSON.stringify(value).toLowerCase()
  expect(text).not.toContain('rawproviderpayload')
  expect(text).not.toContain('providerpayload')
  expect(text).not.toContain('providerplayerid')
  expect(text).not.toContain('api_key')
  expect(text).not.toContain('secret')
}

describe('G49G NFL redraft provider orchestration platform', () => {
  it('exposes the configured provider policy matrix', () => {
    expect(getNflRedraftProviderFallbackOrder(NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES.player_identity)).toEqual([
      'rolling_insights',
      'api_sports',
      'clearsports',
      'canonical_cache',
    ])
    expect(getNflRedraftProviderFallbackOrder(NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES.schedule)).toEqual([
      'rolling_insights',
      'api_sports',
      'canonical_cache',
    ])
    expect(getNflRedraftProviderFallbackOrder(NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES.live_stats)).toEqual([
      'rolling_insights',
      'canonical_cache',
      'runtime',
    ])
    expect(getNflRedraftProviderFallbackOrder(NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES.headshots)).toEqual([
      'thesportsdb',
      'api_sports',
      'rolling_insights',
      'default_avatar',
    ])
    expect(getNflRedraftProviderFallbackOrder(NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES.logos)).toEqual([
      'thesportsdb',
      'api_sports',
      'rolling_insights',
      'af_default_logo',
    ])
    expect(getNflRedraftProviderFallbackOrder(NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES.fantasy_valuations)).toEqual([
      'fantasycalc',
      'internal_historical_model',
      'canonical_cache',
      'hidden',
    ])
    expect(getNflRedraftProviderFallbackOrder(NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES.weather)).toEqual([
      'openweather',
      'canonical_cache',
      'hidden',
    ])
    expect(getNflRedraftProviderFallbackOrder(NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES.news)).toEqual([
      'api_sports',
      'canonical_cache',
      'hidden',
    ])
    expect(getNflRedraftProviderFallbackOrder(NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES.league_import)).toEqual([
      'sleeper',
      'espn',
    ])
  })

  it('builds health summaries without exposing secrets or raw payloads', () => {
    const summaries = buildNflRedraftProviderHealthSummaries({
      configOverrides: {
        rolling_insights: {
          lastSuccessfulSyncIso: '2026-09-13T18:00:00.000Z',
        },
        api_sports: {
          state: 'DEGRADED',
          healthReason: 'rate limit pressure',
        },
      },
    })

    expect(summaries[0]).toMatchObject({
      providerId: 'rolling_insights',
      status: 'ACTIVE',
      subscriptionType: 'backbone',
      activeFallbackCount: 2,
    })
    expect(summaries.find((summary) => summary.providerId === 'api_sports')).toMatchObject({
      status: 'DEGRADED',
      healthReason: 'rate limit pressure',
      activeFallbackCount: 5,
    })
    expectNoCanonicalLeak(summaries)
  })

  it('selects the primary provider when it is healthy and returns sanitized canonical data', () => {
    const result = selectNflRedraftProviderForCapability({
      capability: 'player_identity',
      canonicalDataByProvider: {
        rolling_insights: {
          playerId: 'af-player-1',
          displayName: 'Bijan Robinson',
          providerPlayerId: 'rolling-123',
          rawProviderPayload: { secret: 'never' },
        },
      },
    })

    expect(result).toMatchObject({
      capability: 'player_identity',
      selectedProvider: 'rolling_insights',
      selectedState: 'ACTIVE',
      freshnessStatus: 'available',
      providerPayloadExposed: false,
      providerIdsExposedToCanonicalData: false,
    })
    expect(result.canonicalData).toEqual({
      playerId: 'af-player-1',
      displayName: 'Bijan Robinson',
    })
    expectNoCanonicalLeak(result.canonicalData)
  })

  it('skips expired, disabled, and failed providers through configured fallbacks', () => {
    const valuations = selectNflRedraftProviderForCapability({
      capability: 'fantasy_valuations',
      configOverrides: {
        fantasycalc: { state: 'EXPIRED' },
      },
    })
    const headshots = selectNflRedraftProviderForCapability({
      capability: 'headshots',
      configOverrides: {
        thesportsdb: { state: 'FAILED' },
        api_sports: { enabled: false },
        rolling_insights: { state: 'EXPIRED' },
      },
    })

    expect(valuations.selectedProvider).toBe('internal_historical_model')
    expect(valuations.attemptedProviders[0]).toMatchObject({
      providerId: 'fantasycalc',
      selected: false,
      reason: 'subscription_expired',
    })
    expect(headshots.selectedProvider).toBe('default_avatar')
    expect(headshots.unavailableBehavior).toBe('show_default_media')
    expect(headshots.attemptedProviders.map((provider) => provider.reason)).toEqual([
      'provider_failed',
      'provider_disabled',
      'subscription_expired',
      'selected',
    ])
  })

  it('uses stale canonical cache only when the policy allows it', () => {
    const weather = selectNflRedraftProviderForCapability({
      capability: 'weather',
      cacheFreshness: 'stale',
      configOverrides: {
        openweather: { state: 'EXPIRED' },
      },
    })
    const noStaleCache = selectNflRedraftProviderForCapability({
      capability: 'weather',
      cacheFreshness: 'stale',
      configOverrides: {
        openweather: { state: 'EXPIRED' },
      },
      policyOverrides: {
        weather: { allowStaleCache: false },
      },
    })

    expect(weather).toMatchObject({
      selectedProvider: 'canonical_cache',
      freshnessStatus: 'stale',
      degraded: true,
      warnings: ['canonical_cache:stale'],
    })
    expect(noStaleCache.selectedProvider).toBe('hidden')
    expect(noStaleCache.attemptedProviders[1]).toMatchObject({
      providerId: 'canonical_cache',
      selected: false,
      reason: 'stale_cache_not_allowed',
    })
  })

  it('keeps optional unavailable domains hidden instead of inventing data', () => {
    const result = selectNflRedraftProviderForCapability({
      capability: 'news',
      configOverrides: {
        api_sports: { state: 'EXPIRED' },
        canonical_cache: { state: 'FAILED' },
      },
    })

    expect(result).toMatchObject({
      selectedProvider: 'hidden',
      unavailableBehavior: 'hide_optional_field',
      canonicalData: null,
      freshnessStatus: 'available',
    })
  })

  it('allows capability policies to be overridden without runtime rewrites', () => {
    const result = selectNflRedraftProviderForCapability({
      capability: 'schedule',
      configOverrides: {
        api_sports: { state: 'ACTIVE' },
      },
      policyOverrides: {
        schedule: {
          preferredProvider: 'api_sports',
          secondaryProvider: 'rolling_insights',
          cacheFallback: 'canonical_cache',
        },
      },
    })

    expect(result.selectedProvider).toBe('api_sports')
    expect(result.fallbackChain).toEqual(['api_sports', 'rolling_insights', 'canonical_cache'])
  })

  it('merges canonical provider results by policy priority and records conflicts', () => {
    const result = mergeNflRedraftCanonicalProviderResults({
      capability: 'player_identity',
      results: [
        {
          providerId: 'api_sports',
          canonicalData: {
            displayName: 'B. Robinson',
            byeWeek: 5,
          },
        },
        {
          providerId: 'rolling_insights',
          canonicalData: {
            displayName: 'Bijan Robinson',
            teamAbbreviation: 'ATL',
            providerPlayerId: 'rolling-123',
            rawProviderPayload: { payload: true },
          },
        },
      ],
    })

    expect(result.canonicalData).toEqual({
      displayName: 'Bijan Robinson',
      teamAbbreviation: 'ATL',
      byeWeek: 5,
    })
    expect(result.fieldOwners).toEqual({
      displayName: 'rolling_insights',
      teamAbbreviation: 'rolling_insights',
      byeWeek: 'api_sports',
    })
    expect(result.conflicts).toEqual([
      {
        field: 'displayName',
        keptProvider: 'rolling_insights',
        skippedProvider: 'api_sports',
      },
    ])
    expect(result.providerPayloadExposed).toBe(false)
    expect(result.providerIdsExposedToCanonicalData).toBe(false)
    expectNoCanonicalLeak(result.canonicalData)
  })
})
