import { describe, expect, it } from 'vitest'
import { matchesLiveGameQuery } from '@/lib/live/liveGameSearch'

const game = {
  status: 'scheduled',
  statusDetail: 'Sun 1:00 PM ET',
  home: { name: 'Tennessee Titans', abbrev: 'TEN' },
  away: { name: 'New York Jets', abbrev: 'NYJ' },
  topPerformer: { name: 'Garrett Wilson' },
  tieIns: [{ playerName: 'Breece Hall', leagueName: 'AFC Dreaming!' }],
}

describe('matchesLiveGameQuery', () => {
  it.each(['jets', 'NYJ', 'titans', 'garrett', 'Breece', 'dreaming', '1:00'])('matches %s', (query) => {
    expect(matchesLiveGameQuery(game, query)).toBe(true)
  })

  it('does not include an unrelated game', () => {
    expect(matchesLiveGameQuery(game, 'Yankees')).toBe(false)
  })
})
