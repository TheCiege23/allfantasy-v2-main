import { describe, expect, it } from 'vitest'
import { detectPersistedRosterSchema } from '@/lib/league/getEffectiveLeagueRosterTemplate'

describe('pre-draft checklist defaults', () => {
  it('detectPersistedRosterSchema accepts League.starters object map', () => {
    expect(
      detectPersistedRosterSchema(
        'NFL',
        {},
        { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, BN: 6 },
      ),
    ).toBe(true)
  })

  it('detectPersistedRosterSchema rejects empty object starters', () => {
    expect(detectPersistedRosterSchema('NFL', {}, {})).toBe(false)
  })

  it('ensureLeagueDraftSetupDefaults module exports', async () => {
    const mod = await import('@/lib/league/ensureLeagueDraftSetupDefaults')
    expect(typeof mod.ensureLeagueDraftSetupDefaults).toBe('function')
  })
})
