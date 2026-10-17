import { describe, expect, it, vi } from 'vitest'

// The resolver's module graph reaches the weather service, which imports prisma at load time.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { resolveVenueForTeam } from '@/lib/weather/venueResolver'

/**
 * `resolveVenueForTeam` truncated its input to 4 characters, so a full team name
 * ("Cleveland Browns" → "CLEV") resolved to nothing for every caller. Measured 2026-09-30 as
 * 36 unplaced NFL rows in the weather refresh cron. NFL now folds through the canonical alias
 * map first; every spelling lands on one stadium.
 */
describe('resolveVenueForTeam NFL spellings', () => {
  it('🛑 resolves a full team name to the same stadium as the abbreviation', () => {
    const byAbbrev = resolveVenueForTeam({ sport: 'NFL', teamAbbrev: 'CLE' })
    const byName = resolveVenueForTeam({ sport: 'NFL', teamAbbrev: 'Cleveland Browns' })
    expect(byAbbrev.kind).toBe('coords')
    expect(byName).toEqual(byAbbrev)
  })

  it('resolves a lowercase abbreviation and a mascot', () => {
    const gb = resolveVenueForTeam({ sport: 'NFL', teamAbbrev: 'GB' })
    expect(resolveVenueForTeam({ sport: 'NFL', teamAbbrev: 'gb' })).toEqual(gb)
    expect(resolveVenueForTeam({ sport: 'NFL', teamAbbrev: 'Packers' })).toEqual(gb)
  })

  it('still answers none for an unknown team', () => {
    expect(resolveVenueForTeam({ sport: 'NFL', teamAbbrev: 'Nowhere FC' })).toEqual({ kind: 'none' })
  })
})
