import { describe, expect, it } from 'vitest'

import { detectProviderFromLink } from '@/lib/league-import/detectProviderFromLink'

describe('detectProviderFromLink', () => {
  it.each([
    ['https://fantasy.espn.com/football/league?leagueId=123456', 'espn'],
    ['fantasy.espn.com/basketball/league?leagueId=9', 'espn'],
    ['https://www.fantrax.com/fantasy/league/v2kzedypmm8jp61b/home', 'fantrax'],
    ['https://www44.myfantasyleague.com/2026/home/12345', 'mfl'],
    ['https://www.fleaflicker.com/nfl/leagues/206154', 'fleaflicker'],
    ['https://sleeper.com/leagues/1180000000000000000', 'sleeper'],
    ['https://football.fantasysports.yahoo.com/f1/123456/2', 'yahoo'],
  ])('%s → %s', (input, provider) => {
    expect(detectProviderFromLink(input)).toBe(provider)
  })

  it('never guesses from a bare id or a username', () => {
    expect(detectProviderFromLink('123456')).toBeNull()
    expect(detectProviderFromLink('v2kzedypmm8jp61b')).toBeNull()
    expect(detectProviderFromLink('ciege82')).toBeNull()
    expect(detectProviderFromLink('')).toBeNull()
  })

  it('does not match a look-alike host', () => {
    expect(detectProviderFromLink('https://notespn.com/league?leagueId=1')).toBeNull()
    expect(detectProviderFromLink('https://espn.com.evil.example/x')).toBeNull()
  })
})
