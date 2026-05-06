import { describe, expect, it } from 'vitest'
import {
  THE_SPORTS_DB_CAPABILITIES,
  isTheSportsDbRookieExperienceSupported,
} from '@/lib/providers/theSportsDbCapabilities'

describe('TheSportsDB capabilities', () => {
  it('marks enrichment domains supported', () => {
    expect(THE_SPORTS_DB_CAPABILITIES.images).toBe('supported')
    expect(THE_SPORTS_DB_CAPABILITIES.player_lookup).toBe('supported')
    expect(THE_SPORTS_DB_CAPABILITIES.schedules).toBe('supported')
    expect(THE_SPORTS_DB_CAPABILITIES.livescores_v2).toBe('supported')
  })

  it('marks rookie_experience unknown until fixtures prove fields', () => {
    expect(THE_SPORTS_DB_CAPABILITIES.rookie_experience).toBe('unknown')
    expect(isTheSportsDbRookieExperienceSupported()).toBe(false)
  })
})
