import { describe, expect, it } from 'vitest'
import { parsePlayerSlug, playerPath } from '@/lib/core-app/playerSlug'

describe('public player URLs', () => {
  it('keeps the existing NFL Sleeper URL', () => {
    const path = playerPath({ name: 'Josh Allen', sport: 'NFL', sleeperId: '4984' })
    expect(path).toBe('/players/josh-allen-nfl-4984')
    expect(parsePlayerSlug(path!.slice('/players/'.length))).toEqual({ sport: 'NFL', sleeperId: '4984' })
  })

  it('round trips a non-NFL provider namespace and an id with punctuation', () => {
    const path = playerPath({ name: 'Erling Haaland', sport: 'SOCCER', source: 'api_football', externalId: '1100:one' })
    expect(path).toContain('/players/erling-haaland-soccer-x')
    expect(parsePlayerSlug(path!.slice('/players/'.length))).toEqual({
      sport: 'SOCCER', source: 'api_football', externalId: '1100:one',
    })
    expect(path).not.toBe(playerPath({ name: 'James Daly', sport: 'SOCCER', source: 'rolling_insights', externalId: '1100:one' }))
  })

  it('refuses source-less non-NFL pages and invalid encoded ids', () => {
    expect(playerPath({ name: 'A Player', sport: 'NBA', sleeperId: '1029' })).toBeNull()
    expect(parsePlayerSlug('a-player-nba-xzz')).toBeNull()
    expect(parsePlayerSlug('a-player-nba-x00')).toBeNull()
  })
})
