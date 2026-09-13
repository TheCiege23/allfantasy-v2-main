import { describe, expect, it } from 'vitest'
import { matchLeagueSearchHits } from '@/lib/core-app/topSearch'

const leagues = [
  { id: '1', name: 'AFC Dreaming!', platform: 'Sleeper', mark: 'A' },
  { id: '2', name: 'KBFL', platform: 'Sleeper', mark: 'K' },
  { id: '3', name: 'KBFL', platform: 'Sleeper', mark: 'K' },
  { id: '4', name: 'Sunday Office Pool', platform: 'ESPN', mark: 'S' },
]

describe('matchLeagueSearchHits', () => {
  it('matches league names case-insensitively and collapses re-imported copies', () => {
    expect(matchLeagueSearchHits(leagues, 'kb')).toEqual([
      { ...leagues[1], kind: 'league' },
    ])
  })

  it('can find a connected league by platform and respects the result limit', () => {
    expect(matchLeagueSearchHits(leagues, 'sleeper', 1)).toEqual([
      { ...leagues[0], kind: 'league' },
    ])
  })

  it('does not search on a one-character query', () => {
    expect(matchLeagueSearchHits(leagues, 'k')).toEqual([])
  })
})
