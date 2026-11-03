import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTheSportsDbApiKey } from '@/lib/env/sports-media-keys'

afterEach(() => vi.unstubAllEnvs())

describe('TheSportsDB credential spellings', () => {
  it('accepts the staging thesports_api_key spelling without exposing a value', () => {
    for (const name of ['THESPORTSDB_API_KEY', 'thesportsdb_api_key', 'THESPORTS_API_KEY',
      'THEAUDIODB_API_KEY', 'theaudiodb_api_key']) vi.stubEnv(name, '')
    vi.stubEnv('thesports_api_key', 'fixture-only-value')
    expect(getTheSportsDbApiKey()).toBe('fixture-only-value')
  })
  it('prefers the canonical variable when both are configured', () => {
    vi.stubEnv('THESPORTSDB_API_KEY', 'canonical-fixture')
    vi.stubEnv('thesports_api_key', 'alias-fixture')
    expect(getTheSportsDbApiKey()).toBe('canonical-fixture')
  })
})
