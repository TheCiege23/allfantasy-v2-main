import { describe, expect, it } from 'vitest'

import { teamLogoUrl } from '@/lib/core-app/teamLogo'

/*
 * A crest only for a club the registry knows. Production stores NFL teams as
 * abbreviations (NYJ, ARI, CAR); this screen's fixtures use full names; the
 * abbreviation table folds both, and everything else is null rather than a
 * URL the CDN would 404.
 */
describe('teamLogoUrl', () => {
  it('builds the ESPN path from an abbreviation, an alias, or a full name', () => {
    expect(teamLogoUrl('NFL', 'BUF')).toBe('https://a.espncdn.com/i/teamlogos/nfl/500/buf.png')
    expect(teamLogoUrl('nfl', 'jac')).toBe('https://a.espncdn.com/i/teamlogos/nfl/500/jax.png')
    expect(teamLogoUrl('NFL', 'Buffalo Bills')).toBe('https://a.espncdn.com/i/teamlogos/nfl/500/buf.png')
    expect(teamLogoUrl('NFL', 'Washington Commanders')).toBe('https://a.espncdn.com/i/teamlogos/nfl/500/was.png')
  })

  /* ⚠ NULL BEATS A GUESS: "FA" is not a club and gets no crest. */
  it('returns nothing for a free agent, an unknown code, an unknown sport, or no team', () => {
    expect(teamLogoUrl('NFL', 'FA')).toBeNull()
    expect(teamLogoUrl('NFL', 'Free Agent')).toBeNull()
    expect(teamLogoUrl('NFL', null)).toBeNull()
    expect(teamLogoUrl(null, 'BUF')).toBeNull()
    expect(teamLogoUrl('CRICKET', 'BUF')).toBeNull()
    expect(teamLogoUrl('NFL', '')).toBeNull()
  })

  it('resolves other sports through the registry by abbreviation only', () => {
    expect(teamLogoUrl('NBA', 'LAL')).toBe('https://a.espncdn.com/i/teamlogos/nba/500/lal.png')
    expect(teamLogoUrl('NBA', 'Los Angeles Lakers')).toBeNull()
  })
})
