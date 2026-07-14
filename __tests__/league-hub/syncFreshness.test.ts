import { describe, expect, it } from 'vitest'
import { deriveSyncFreshness } from '@/lib/shared-services/league-hub/syncFreshness'

const NOW = new Date('2026-07-12T12:00:00Z')

describe('deriveSyncFreshness', () => {
  it('native leagues are always not_applicable, regardless of lastSyncedAt', () => {
    const result = deriveSyncFreshness({
      provider: 'allfantasy',
      syncStatus: null,
      lastSyncedAt: NOW,
      now: NOW,
    })
    expect(result.state).toBe('not_applicable')
  })

  it('syncStatus manual is not_applicable even for a non-native provider string', () => {
    const result = deriveSyncFreshness({ provider: 'sleeper', syncStatus: 'manual', lastSyncedAt: null, now: NOW })
    expect(result.state).toBe('not_applicable')
  })

  it('syncStatus error maps to failed', () => {
    const result = deriveSyncFreshness({ provider: 'espn', syncStatus: 'error', lastSyncedAt: NOW, now: NOW })
    expect(result.state).toBe('failed')
  })

  it('no lastSyncedAt at all maps to never_synced', () => {
    const result = deriveSyncFreshness({ provider: 'mfl', syncStatus: 'pending', lastSyncedAt: null, now: NOW })
    expect(result.state).toBe('never_synced')
    expect(result.lastSyncedAt).toBeNull()
  })

  it('lastSyncedAt within 24h is fresh', () => {
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000)
    const result = deriveSyncFreshness({ provider: 'yahoo', syncStatus: 'success', lastSyncedAt: oneHourAgo, now: NOW })
    expect(result.state).toBe('fresh')
  })

  it('lastSyncedAt older than 24h is stale', () => {
    const twoDaysAgo = new Date(NOW.getTime() - 48 * 60 * 60 * 1000)
    const result = deriveSyncFreshness({ provider: 'fantrax', syncStatus: 'success', lastSyncedAt: twoDaysAgo, now: NOW })
    expect(result.state).toBe('stale')
  })

  it('never invents a timestamp — lastSyncedAt passthrough is always the real input, isoformatted', () => {
    const real = new Date('2026-07-10T08:00:00Z')
    const result = deriveSyncFreshness({ provider: 'sleeper', syncStatus: 'success', lastSyncedAt: real, now: NOW })
    expect(result.lastSyncedAt).toBe(real.toISOString())
  })
})
