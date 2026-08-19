import { describe, expect, it } from 'vitest'
import {
  buildNflRedraftProviderFreshness,
  buildNflRedraftProviderHealthReport,
  getNflRedraftFallbackChain,
  normalizeNflRedraftProviderError,
  shouldRetryNflRedraftProviderError,
  toCanonicalNflRedraftProviderRecord,
  validateNflRedraftProviderEnv,
} from '@/lib/nfl-provider'

const emptyEnv = {} as NodeJS.ProcessEnv

describe('G45 NFL redraft provider integration foundation', () => {
  it('validates provider env without exposing secret values', () => {
    const rows = validateNflRedraftProviderEnv({
      SPORTSDATAIO_API_KEY: 'sports-key',
      OPENWEATHERMAP_API_KEY: 'weather-key',
    } as NodeJS.ProcessEnv)

    expect(rows.find((row) => row.providerId === 'sportsdataio')).toMatchObject({
      configured: true,
      keyUsed: 'SPORTSDATAIO_API_KEY',
      missingEnv: [],
    })
    expect(rows.find((row) => row.providerId === 'openweather')).toMatchObject({
      configured: true,
      keyUsed: 'OPENWEATHERMAP_API_KEY',
      missingEnv: [],
    })
    expect(JSON.stringify(rows)).not.toContain('sports-key')
    expect(JSON.stringify(rows)).not.toContain('weather-key')
  })

  it('builds configured fallback chains and keeps deterministic fixtures last', () => {
    expect(getNflRedraftFallbackChain('live_score', emptyEnv)).toEqual(['deterministic'])
    expect(getNflRedraftFallbackChain('player_metadata', emptyEnv)).toEqual(['sleeper', 'deterministic'])
    expect(
      getNflRedraftFallbackChain('live_score', {
        SPORTSDATA_API_KEY: 'configured',
      } as NodeJS.ProcessEnv),
    ).toEqual(['sportsdataio', 'deterministic'])
  })

  it('reports launch blockers for missing primary live, projection, injury, and weather providers', () => {
    const report = buildNflRedraftProviderHealthReport(emptyEnv, new Date('2026-07-03T12:00:00.000Z'))

    expect(report.providers.find((provider) => provider.providerId === 'sleeper')).toMatchObject({
      status: 'available',
      configured: true,
    })
    expect(report.providers.find((provider) => provider.providerId === 'deterministic')).toMatchObject({
      status: 'fallback_only',
      configured: true,
    })
    expect(report.launchBlockers).toEqual(
      expect.arrayContaining([
        'Live scoring has no configured primary provider.',
        'Projection data has no configured primary provider.',
        'Injury data has no configured primary provider.',
        'Weather context has no configured weather provider.',
      ]),
    )
  })

  it('tracks freshness for canonical provider records', () => {
    const fresh = buildNflRedraftProviderFreshness({
      updatedAtIso: '2026-07-03T11:30:00.000Z',
      maxAgeMinutes: 60,
      now: new Date('2026-07-03T12:00:00.000Z'),
    })
    const stale = buildNflRedraftProviderFreshness({
      updatedAtIso: '2026-07-03T08:00:00.000Z',
      maxAgeMinutes: 60,
      now: new Date('2026-07-03T12:00:00.000Z'),
    })

    expect(fresh).toMatchObject({ status: 'fresh', ageMinutes: 30 })
    expect(stale).toMatchObject({ status: 'stale', ageMinutes: 240 })

    const row = toCanonicalNflRedraftProviderRecord({
      providerId: 'sportsdataio',
      providerRecordId: 'player-1',
      data: { playerId: 'player-1', projectedPoints: 18.4 },
      sourceUpdatedAtIso: '2026-07-03T08:00:00.000Z',
      maxAgeMinutes: 60,
      fallback: false,
      now: new Date('2026-07-03T12:00:00.000Z'),
    })
    expect(row.freshness.status).toBe('stale')
    expect(row.data.projectedPoints).toBe(18.4)
  })

  it('normalizes provider errors and marks retryable cases', () => {
    const rateLimited = normalizeNflRedraftProviderError({
      providerId: 'sleeper',
      error: new Error('Too many requests'),
      status: 429,
    })
    const denied = normalizeNflRedraftProviderError({
      providerId: 'sportsdataio',
      error: new Error('Bad key'),
      status: 401,
    })

    expect(rateLimited).toMatchObject({ code: 'rate_limited', retryable: true })
    expect(shouldRetryNflRedraftProviderError(rateLimited)).toBe(true)
    expect(denied).toMatchObject({ code: 'invalid_credentials', retryable: false, retryAfterMs: null })
    expect(shouldRetryNflRedraftProviderError(denied)).toBe(false)
  })
})
