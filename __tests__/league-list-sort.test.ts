import { describe, expect, it } from 'vitest'
import { hasLeagueSortMetric, sortLeagues } from '@/lib/league-list/sortLeagues'

const leagues = [
  { name: 'Zebras', sport: 'NFL', leagueType: 'dynasty', viewerWins: 6, viewerLosses: 4, viewerTies: 0, viewerPlayoffOdds: 45 },
  { name: 'Aces', sport: 'NBA', leagueType: 'dynasty', viewerWins: 5, viewerLosses: 1, viewerTies: 0, viewerPlayoffOdds: 78 },
  { name: 'Bears', sport: 'NFL', leagueType: 'redraft', viewerWins: null, viewerLosses: null, viewerTies: null, viewerPlayoffOdds: null },
]

describe('league list sorting', () => {
  it('sorts by sport then name or type without changing the source order', () => {
    expect(sortLeagues(leagues, 'sport-name').map((league) => league.name)).toEqual(['Aces', 'Bears', 'Zebras'])
    expect(sortLeagues(leagues, 'sport-type').map((league) => league.name)).toEqual(['Aces', 'Zebras', 'Bears'])
    expect(leagues.map((league) => league.name)).toEqual(['Zebras', 'Aces', 'Bears'])
  })

  it('supports name directions and league type', () => {
    expect(sortLeagues(leagues, 'name-asc').map((league) => league.name)).toEqual(['Aces', 'Bears', 'Zebras'])
    expect(sortLeagues(leagues, 'name-desc').map((league) => league.name)).toEqual(['Zebras', 'Bears', 'Aces'])
    expect(sortLeagues(leagues, 'type-name').map((league) => league.name)).toEqual(['Aces', 'Zebras', 'Bears'])
  })

  it('sorts real results and forecasts, leaving missing values last', () => {
    expect(sortLeagues(leagues, 'wins').map((league) => league.name)).toEqual(['Zebras', 'Aces', 'Bears'])
    expect(sortLeagues(leagues, 'win-pct').map((league) => league.name)).toEqual(['Aces', 'Zebras', 'Bears'])
    expect(sortLeagues(leagues, 'playoff-odds').map((league) => league.name)).toEqual(['Aces', 'Zebras', 'Bears'])
  })

  it('disables record and playoff sorts when the account has no data', () => {
    expect(hasLeagueSortMetric([leagues[2]], 'wins')).toBe(false)
    expect(hasLeagueSortMetric([leagues[2]], 'win-pct')).toBe(false)
    expect(hasLeagueSortMetric([leagues[2]], 'playoff-odds')).toBe(false)
    expect(hasLeagueSortMetric([leagues[2]], 'sport-name')).toBe(true)
  })
})
