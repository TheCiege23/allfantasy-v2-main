// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { simulateOddsBands, simulateSeason, type SimInput } from '@/lib/core-app/outlookSim'
import { leagueSimHash } from '@/lib/core-app/seasonOutlookSims'
import { liveWeeks, remainingShare, withLiveScores } from '@/lib/core-app/outlookLiveShare'

/*
 * HailShiva, week 4 of 2026: the board read 135.5–129.9 with every starter finished, and the simulator
 * still drew the game from the pre-game fits (126.4 vs 154.8, about a 29% game) because a week counts as
 * played only once final. One playoff spot, one game left, level records: the winner is the field.
 */
const sim = (live?: SimInput['remaining'][number]['live']): SimInput => ({
  teams: [
    { rosterId: 'you', wins: 2, losses: 1, pointsFor: 400, profile: { mu: 126.4, sigma: 25, n: 40 } },
    { rosterId: 'paid', wins: 2, losses: 1, pointsFor: 400, profile: { mu: 154.8, sigma: 25, n: 40 } },
  ],
  remaining: [{ week: 4, a: 'you', b: 'paid', ...(live ? { live } : {}) }],
  playoffTeams: 1,
  byeTeams: 0,
})
const odds = (s: SimInput) => simulateSeason(s, { iterations: 4000, seed: 7 }).counts.you.playoff / 40

describe('a game already under way', () => {
  it('a finished board decides the game, whatever the pre-game fits said', () => {
    const before = odds(sim())
    expect(before).toBeGreaterThan(15)
    expect(before).toBeLessThan(35)
    expect(odds(sim({ a: 135.5, b: 129.9, restA: 0, restB: 0 }))).toBe(100)
    expect(odds(sim({ a: 120, b: 129.9, restA: 0, restB: 0 }))).toBe(0)
  })

  it('a partial board moves the odds toward the scoreboard, and further as the week runs out', () => {
    const early = odds(sim({ a: 40, b: 20, restA: 0.75, restB: 0.75 }))
    const late = odds(sim({ a: 120, b: 90, restA: 0.2, restB: 0.2 }))
    expect(early).toBeGreaterThan(odds(sim()))
    expect(late).toBeGreaterThan(early)
    expect(late).toBeLessThan(100)
  })

  it('a lineup with players left can still come back from behind', () => {
    // Trailing by 30 with the whole lineup to play against a finished opponent.
    expect(odds(sim({ a: 0, b: 30, restA: 1, restB: 0 }))).toBeGreaterThan(50)
  })

  it('an unplayed board is exactly the old draw, from the same random numbers', () => {
    const plain = simulateSeason(sim(), { iterations: 500, seed: 11 })
    const zero = simulateSeason(sim({ a: 0, b: 0, restA: 1, restB: 1 }), { iterations: 500, seed: 11 })
    expect(zero.counts).toEqual(plain.counts)
    expect(zero.finishes).toEqual(plain.finishes)
  })

  it('reaches the uncertainty bands and the win/lose branches too', () => {
    const bands = simulateOddsBands(sim({ a: 135.5, b: 129.9, restA: 0, restB: 0 }), { iterations: 500, seed: 3, batches: 4 })
    expect(bands.you.playoff).toEqual({ lo: 100, hi: 100 })
    const forced = simulateSeason(sim({ a: 135.5, b: 129.9, restA: 0, restB: 0 }), { iterations: 200, seed: 3, forced: [{ week: 4, a: 'you', b: 'paid', winner: 'paid' }] })
    expect(forced.counts.you.playoff).toBe(0)
  })

  it('a changed board is a new stored run; an unplayed game hashes as it always did', () => {
    expect(leagueSimHash(sim({ a: 135.5, b: 129.9, restA: 0, restB: 0 }), 1)).not.toBe(leagueSimHash(sim(), 1))
    expect(leagueSimHash(sim({ a: 135.5, b: 129.9, restA: 0, restB: 0 }), 1)).not.toBe(leagueSimHash(sim({ a: 135.5, b: 131, restA: 0, restB: 0 }), 1))
    expect(leagueSimHash({ ...sim(), remaining: [{ week: 4, a: 'you', b: 'paid' }] }, 1)).toBe(leagueSimHash(sim(), 1))
  })
})

describe('reading a board', () => {
  it('counts final as played, live as half, and anything unreadable as still to play', () => {
    expect(remainingShare(['final', 'final', 'final', 'final'])).toBe(0)
    expect(remainingShare(['final', 'live', 'upcoming', 'upcoming'])).toBe(0.625)
    expect(remainingShare(['final', 'unknown'])).toBe(0.5)
    expect(remainingShare([])).toBeNull()
  })

  const rows = [
    { week: 4, rosterId: 'you', pointsFor: 135.5, pointsAgainst: 129.9 },
    { week: 4, rosterId: 'paid', pointsFor: 129.9, pointsAgainst: 135.5 },
    { week: 5, rosterId: 'you', pointsFor: 0, pointsAgainst: 0 },
    { week: 5, rosterId: 'ritt', pointsFor: 0, pointsAgainst: 0 },
  ]
  const games = [{ week: 4, a: 'you', b: 'paid' }, { week: 5, a: 'you', b: 'ritt' }]

  it('finds only the weeks with points on the board', () => {
    expect(liveWeeks(games, rows)).toEqual([4])
  })

  it('attaches the board where both lineups read, and leaves the rest unplayed', () => {
    const out = withLiveScores(games, rows, () => 0)
    expect(out.games[0].live).toEqual({ a: 135.5, b: 129.9, restA: 0, restB: 0 })
    expect(out.games[1].live).toBeUndefined()
    expect(out.attached).toEqual([4])
    expect(out.unread).toEqual([])
  })

  it('never guesses a lineup it could not read', () => {
    const out = withLiveScores(games, rows, (_w, id) => (id === 'you' ? 0 : undefined))
    expect(out.games[0].live).toBeUndefined()
    expect(out.unread).toEqual([4])
  })
})
