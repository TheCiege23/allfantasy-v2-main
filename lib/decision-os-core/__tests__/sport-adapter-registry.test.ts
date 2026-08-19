import { describe, expect, it } from 'vitest'
import { SportAdapterRegistry } from '../sport-adapter/registry'
import { UnknownSportAdapterError, type SportAdapter } from '../sport-adapter/types'
import { registerDefaultSportAdapters, buildSportAdapterFromConfig } from '../sport-adapter/adapters'

function fakeAdapter(sport: string): SportAdapter {
  return {
    sport,
    scheduleUnit: 'week',
    competitionStructure: 'season_long_h2h',
    rosterSlotCategories: ['starter', 'bench'],
    scoringStatVocabulary: ['stat_a', 'stat_b'],
    supportsIDP: false,
    tracksProviderDataCoverage: false,
    parseRawStats: (raw) => raw,
    getLineupLockTime: (iso) => new Date(iso),
  }
}

describe('SportAdapterRegistry', () => {
  it('registers and resolves an adapter', () => {
    const registry = new SportAdapterRegistry()
    registry.register(fakeAdapter('NFL'))
    expect(registry.has('NFL')).toBe(true)
    expect(registry.resolve('NFL').sport).toBe('NFL')
  })

  it('is case-insensitive and trims whitespace on lookup', () => {
    const registry = new SportAdapterRegistry()
    registry.register(fakeAdapter('NFL'))
    expect(registry.has('nfl')).toBe(true)
    expect(registry.has(' Nfl ')).toBe(true)
    expect(registry.resolve('nfl').sport).toBe('NFL')
  })

  it('throws a typed error for an unknown sport on resolve()', () => {
    const registry = new SportAdapterRegistry()
    expect(() => registry.resolve('KORFBALL')).toThrow(UnknownSportAdapterError)
  })

  it('returns null (never throws) for an unknown sport on tryResolve()', () => {
    const registry = new SportAdapterRegistry()
    expect(registry.tryResolve('KORFBALL')).toBeNull()
  })

  it('list() reflects registered sports only', () => {
    const registry = new SportAdapterRegistry()
    expect(registry.list()).toEqual([])
    registry.register(fakeAdapter('NFL'))
    registry.register(fakeAdapter('MLB'))
    expect(registry.list().sort()).toEqual(['MLB', 'NFL'])
  })

  it('clear() empties the registry', () => {
    const registry = new SportAdapterRegistry()
    registry.register(fakeAdapter('NFL'))
    registry.clear()
    expect(registry.list()).toEqual([])
  })

  it('re-registering the same sport overwrites, never duplicates', () => {
    const registry = new SportAdapterRegistry()
    registry.register(fakeAdapter('NFL'))
    registry.register({ ...fakeAdapter('NFL'), supportsIDP: true })
    expect(registry.list()).toEqual(['NFL'])
    expect(registry.resolve('NFL').supportsIDP).toBe(true)
  })
})

describe('buildSportAdapterFromConfig (wraps lib/sportConfig)', () => {
  it('builds a real adapter for NFL from the existing sport config', () => {
    const adapter = buildSportAdapterFromConfig('NFL')
    expect(adapter).not.toBeNull()
    expect(adapter!.sport).toBe('NFL')
    expect(adapter!.scoringStatVocabulary.length).toBeGreaterThan(0)
    expect(adapter!.supportsIDP).toBe(true)
    expect(adapter!.getLineupLockTime('2026-09-08T17:00:00.000Z')).toBeInstanceOf(Date)
  })

  it('flags NFL (and only NFL) as tracking provider data coverage', () => {
    // Mirrors the exact real-world set of sports with a wired data-coverage
    // signal today (lib/decision-os/commissioner-health), which
    // lib/decision-os/commissioner-health/dco.ts now resolves through this
    // adapter instead of an inline `sport === 'NFL'` string comparison.
    expect(buildSportAdapterFromConfig('NFL')!.tracksProviderDataCoverage).toBe(true)
    expect(buildSportAdapterFromConfig('NCAAF')!.tracksProviderDataCoverage).toBe(false)
    expect(buildSportAdapterFromConfig('MLB')!.tracksProviderDataCoverage).toBe(false)
    expect(buildSportAdapterFromConfig('GOLF')!.tracksProviderDataCoverage).toBe(false)
  })

  it('is case-insensitive for tracksProviderDataCoverage, matching the old sport.toUpperCase() check', () => {
    expect(buildSportAdapterFromConfig('nfl')!.tracksProviderDataCoverage).toBe(true)
    expect(buildSportAdapterFromConfig('Nfl')!.tracksProviderDataCoverage).toBe(true)
  })

  it('returns null (never throws) for a sport with no config', () => {
    expect(buildSportAdapterFromConfig('KORFBALL')).toBeNull()
  })

  it('parseRawStats only returns known vocabulary keys, defaulting missing ones to 0', () => {
    const adapter = buildSportAdapterFromConfig('GOLF')
    expect(adapter).not.toBeNull()
    const parsed = adapter!.parseRawStats({ birdies: 3, unknown_stat: 99 })
    expect(parsed['birdies']).toBe(3)
    expect(parsed).not.toHaveProperty('unknown_stat')
  })
})

describe('registerDefaultSportAdapters', () => {
  it('registers every sport currently defined in lib/sportConfig without throwing', () => {
    const registry = new SportAdapterRegistry()
    expect(() => registerDefaultSportAdapters(registry)).not.toThrow()
    expect(registry.list().length).toBeGreaterThanOrEqual(7)
    expect(registry.has('NFL')).toBe(true)
    expect(registry.has('NCAAF')).toBe(true)
  })

  it('does not mutate the shared singleton registry as a side effect of import', async () => {
    const { sportAdapterRegistry } = await import('../sport-adapter/registry')
    // Importing the adapters module must not itself populate the singleton —
    // only an explicit registerDefaultSportAdapters() call does.
    expect(sportAdapterRegistry.list()).toEqual([])
  })
})
