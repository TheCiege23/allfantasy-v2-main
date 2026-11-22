import { describe, expect, it } from 'vitest'
import { resolveAfcChampionships, validAfcPairings, type AfcScore } from '@/lib/afc-championships/bracket'

const score = (week: number, seed: AfcScore['seed'], points: number, final = true): AfcScore => ({ week, seed, points, final })
const opener = [score(9, 34, 77.2), score(9, 33, 93.5)]
const secondRound = [
  score(10, 33, 128), score(10, 4, 164), score(10, 27, 60), score(10, 2, 100),
  score(10, 23, 111), score(10, 5, 98), score(10, 17, 131), score(10, 6, 179),
  score(10, 18, 95), score(10, 9, 155), score(10, 24, 88), score(10, 7, 136),
  score(10, 15, 128), score(10, 8, 165), score(10, 12, 130), score(10, 11, 152),
]

describe('AFC Championships staging bracket', () => {
  it('replays the play-in and preserves the confirmed quarterfinal feeder order', () => {
    const rounds = resolveAfcChampionships([...opener, ...secondRound])
    expect(rounds[0].games[0]).toMatchObject({ winner: 33, status: 'final' })
    expect(rounds[1].games[0]).toMatchObject({ away: 33, home: 4, status: 'final' })
    expect(rounds[2].defaults).toEqual([[4, 23], [11, 2], [8, 7], [9, 6]])
    expect(rounds[2].canOverride).toBe(true)
    expect(rounds[3].games.every(game => game.away == null && game.home == null)).toBe(true)
  })

  it('will not advance provisional results or tied finals even at zero', () => {
    const live = resolveAfcChampionships([score(9, 34, 0), score(9, 33, 100, false)])
    expect(live[0].games[0]).toMatchObject({ awayPoints: 0, winner: null, status: 'scoring' })
    expect(live[1].games[0].away).toBeNull()
    expect(live[0].canOverride).toBe(false)
    const tied = resolveAfcChampionships([score(9, 34, 0), score(9, 33, 0)])
    expect(tied[0].games[0]).toMatchObject({ winner: null, status: 'tied' })
    expect(tied[1].games[0].away).toBeNull()
  })

  it('uses commissioner pairings and advances the winners of those pairings', () => {
    const scores = [...opener, ...secondRound,
      score(11, 23, 101), score(11, 2, 112), score(11, 11, 102), score(11, 4, 90)]
    const overrides = { 3: [{ away: 23, home: 2 }, { away: 11, home: 4 }, { away: 8, home: 7 }, { away: 9, home: 6 }] } as const
    const rounds = resolveAfcChampionships(scores, { 3: [...overrides[3]] })
    expect(rounds[2].overridden).toBe(true)
    expect(rounds[2].canOverride).toBe(false)
    expect(rounds[3].games[0]).toMatchObject({ away: 2, home: 11, status: 'scheduled' })
    expect(validAfcPairings(rounds[2].defaults, [{ away: 4, home: 4 }])).toBe(false)
  })

  it('surfaces stale overrides for review if a previously finalized winner changes', () => {
    const rounds = resolveAfcChampionships([...opener, ...secondRound, score(10, 33, 200)], {
      3: [{ away: 4, home: 23 }, { away: 11, home: 2 }, { away: 8, home: 7 }, { away: 9, home: 6 }],
    })
    expect(rounds[2]).toMatchObject({ overridden: false, overrideNeedsReview: true })
    expect(rounds[2].games[0]).toMatchObject({ away: 33, home: 23 })
  })

  it('finalizes the bracket when the last two finalists have final AF scores', () => {
    const rounds = resolveAfcChampionships([
      ...opener, ...secondRound,
      score(11, 4, 120), score(11, 23, 100), score(11, 11, 120), score(11, 2, 100),
      score(11, 8, 120), score(11, 7, 100), score(11, 9, 120), score(11, 6, 100),
      score(12, 4, 130), score(12, 11, 100), score(12, 8, 100), score(12, 9, 130),
      score(13, 4, 105), score(13, 9, 115),
    ])
    expect(rounds[4].games[0]).toMatchObject({ away: 4, home: 9, winner: 9, status: 'final' })
  })
})
