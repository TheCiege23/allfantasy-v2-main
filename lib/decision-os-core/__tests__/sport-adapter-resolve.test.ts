import { describe, expect, it } from 'vitest'
import { resolveSportAdapter } from '../sport-adapter/resolve'
import { SportAdapterRegistry } from '../sport-adapter/registry'
import type { SportAdapter } from '../sport-adapter/types'

function fakeAdapter(overrides: Partial<SportAdapter> = {}): SportAdapter {
  return {
    sport: 'NFL',
    scheduleUnit: 'week',
    competitionStructure: 'season_long_h2h',
    rosterSlotCategories: [],
    scoringStatVocabulary: [],
    supportsIDP: false,
    tracksProviderDataCoverage: false,
    parseRawStats: (raw) => raw,
    getLineupLockTime: (iso) => new Date(iso),
    ...overrides,
  }
}

describe('resolveSportAdapter', () => {
  it('falls back to buildSportAdapterFromConfig when nothing is registered (default real-world state)', () => {
    const registry = new SportAdapterRegistry()
    const adapter = resolveSportAdapter('NFL', registry)
    expect(adapter).not.toBeNull()
    expect(adapter!.sport).toBe('NFL')
    expect(adapter!.tracksProviderDataCoverage).toBe(true)
  })

  it('prefers a registered adapter over the config-derived fallback', () => {
    const registry = new SportAdapterRegistry()
    registry.register(fakeAdapter({ sport: 'NFL', tracksProviderDataCoverage: false }))
    const adapter = resolveSportAdapter('NFL', registry)
    expect(adapter!.tracksProviderDataCoverage).toBe(false)
  })

  it('returns null (never throws) for a sport unknown to both the registry and the config factory', () => {
    const registry = new SportAdapterRegistry()
    expect(resolveSportAdapter('KORFBALL', registry)).toBeNull()
  })

  it('defaults to the shared singleton registry when none is passed', () => {
    // The shared singleton starts empty (per Phase 1), so this exercises the
    // same fallback-to-config path as the no-registry case above.
    const adapter = resolveSportAdapter('NFL')
    expect(adapter!.sport).toBe('NFL')
  })
})
