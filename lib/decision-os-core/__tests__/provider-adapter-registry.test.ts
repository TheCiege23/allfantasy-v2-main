import { describe, expect, it } from 'vitest'
import { ProviderAdapterRegistry } from '../provider-adapter/registry'
import { UnknownProviderAdapterError, type ProviderAdapter } from '../provider-adapter/types'
import {
  registerDefaultProviderAdapters,
  buildProviderAdapterFromFallbackPolicy,
} from '../provider-adapter/adapters'
import { ProviderFetchNotWiredError } from '../provider-adapter/adapters/fromProviderFallbackPolicy'

function fakeAdapter(providerName: ProviderAdapter['providerName']): ProviderAdapter {
  return {
    providerName,
    supportedSports: ['NFL'],
    supportedDomains: ['player_profile'],
    fetch: async () => null,
  }
}

describe('ProviderAdapterRegistry', () => {
  it('registers and resolves an adapter', () => {
    const registry = new ProviderAdapterRegistry()
    registry.register(fakeAdapter('sleeper'))
    expect(registry.has('sleeper')).toBe(true)
    expect(registry.resolve('sleeper').providerName).toBe('sleeper')
  })

  it('is case-insensitive and trims whitespace on lookup', () => {
    const registry = new ProviderAdapterRegistry()
    registry.register(fakeAdapter('sleeper'))
    expect(registry.has('SLEEPER')).toBe(true)
    expect(registry.has(' Sleeper ')).toBe(true)
  })

  it('throws a typed error for an unknown provider on resolve()', () => {
    const registry = new ProviderAdapterRegistry()
    expect(() => registry.resolve('made_up_provider')).toThrow(UnknownProviderAdapterError)
  })

  it('returns null (never throws) for an unknown provider on tryResolve()', () => {
    const registry = new ProviderAdapterRegistry()
    expect(registry.tryResolve('made_up_provider')).toBeNull()
  })

  it('clear() empties the registry', () => {
    const registry = new ProviderAdapterRegistry()
    registry.register(fakeAdapter('sleeper'))
    registry.clear()
    expect(registry.list()).toEqual([])
  })
})

describe('buildProviderAdapterFromFallbackPolicy (wraps lib/providers/providerFallbackPolicy)', () => {
  it('derives non-empty supportedDomains for a known provider from the existing fallback chains', () => {
    const adapter = buildProviderAdapterFromFallbackPolicy('rolling_insights')
    expect(adapter.supportedDomains.length).toBeGreaterThan(0)
    expect(adapter.supportedDomains).toContain('player_profile')
  })

  it('derives a narrow supportedDomains set for allfantasy_internal (its real-world role)', () => {
    const adapter = buildProviderAdapterFromFallbackPolicy('allfantasy_internal')
    expect(adapter.supportedDomains).toContain('waiver_value')
  })

  it('fetch() throws ProviderFetchNotWiredError rather than silently returning fabricated data', async () => {
    const adapter = buildProviderAdapterFromFallbackPolicy('sleeper')
    await expect(adapter.fetch('player_profile', 'NFL', {})).rejects.toThrow(ProviderFetchNotWiredError)
  })
})

describe('registerDefaultProviderAdapters', () => {
  it('registers all five known providers without throwing', () => {
    const registry = new ProviderAdapterRegistry()
    expect(() => registerDefaultProviderAdapters(registry)).not.toThrow()
    expect(registry.list().sort()).toEqual(
      ['allfantasy_internal', 'clearsports', 'rolling_insights', 'sleeper', 'thesportsdb'].sort(),
    )
  })

  it('does not mutate the shared singleton registry as a side effect of import', async () => {
    const { providerAdapterRegistry } = await import('../provider-adapter/registry')
    expect(providerAdapterRegistry.list()).toEqual([])
  })
})
