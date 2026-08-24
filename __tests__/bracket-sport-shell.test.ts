import { describe, expect, it } from 'vitest'
import {
  SPORT_ORDER,
  SPORT_SHELLS,
  firstRoundPairs,
  resolveSport,
  scoreBracket,
  seedsPerSide,
  toClientShell,
} from '@/lib/brackets/sportShell'

/**
 * 28a — the shell's rules, pinned.
 *
 * These are not incidental implementation details: they are the rules a pool is
 * scored on, and the two failure modes they guard against both look correct on
 * screen. A bracket that scores an unplayed round as a miss tells an entrant
 * they are eliminated in October; a bracket that pre-fills a bye's opponent
 * shows a matchup nobody has earned.
 */

describe('sport shell — structure', () => {
  it('splits every sport evenly into two sides', () => {
    for (const key of SPORT_ORDER) {
      const shell = SPORT_SHELLS[key]
      expect(shell.teamCount % 2, `${key} must divide into two sides`).toBe(0)
      expect(seedsPerSide(shell)).toBe(shell.teamCount / 2)
    }
  })

  it('pairs MLB seeds 3v6 and 4v5, leaving 1 and 2 on a bye', () => {
    const shell = SPORT_SHELLS.mlb
    expect(shell.byeSeeds).toEqual([1, 2])
    expect(firstRoundPairs(shell)).toEqual([
      [3, 6],
      [4, 5],
    ])
  })

  it('never pairs a bye seed into the first round, for any sport', () => {
    for (const key of SPORT_ORDER) {
      const shell = SPORT_SHELLS[key]
      const paired = firstRoundPairs(shell).flat()
      for (const seed of shell.byeSeeds) {
        expect(paired, `${key}: seed ${seed} has a bye and must not play round one`).not.toContain(seed)
      }
    }
  })

  it('carries MLB’s real series formats, not a uniform best-of-seven', () => {
    const byId = Object.fromEntries(SPORT_SHELLS.mlb.rounds.map((r) => [r.id, r]))
    expect(byId.wc.bestOf).toBe(3)
    expect(byId.ds.bestOf).toBe(5)
    expect(byId.cs.bestOf).toBe(7)
    expect(byId.ws.bestOf).toBe(7)
    expect([byId.wc.points, byId.ds.points, byId.cs.points, byId.ws.points]).toEqual([5, 10, 18, 30])
  })

  it('offers no series-length bonus where the final is a single game', () => {
    // The NFL's Super Bowl has no length to call.
    expect(SPORT_SHELLS.nfl.finalLength).toBeNull()
    expect(SPORT_SHELLS.mlb.finalLength).toEqual({ bonus: 5, options: [4, 5, 6, 7] })
  })

  it('falls back to MLB for an unknown or missing sport rather than throwing', () => {
    expect(resolveSport('nba')).toBe('nba')
    expect(resolveSport('QUIDDITCH')).toBe('mlb')
    expect(resolveSport(null)).toBe('mlb')
  })

  it('strips the server-only RegExp before a shell reaches a client component', () => {
    /*
     * A RegExp cannot cross the server→client boundary — React throws "Only
     * plain objects can be passed to Client Components". This is the guard.
     */
    const client = toClientShell(SPORT_SHELLS.mlb)
    expect(client).not.toHaveProperty('conferenceMatch')
    expect(() => JSON.parse(JSON.stringify(client))).not.toThrow()
    expect(client.teamCount).toBe(12)
  })
})

describe('sport shell — scoring', () => {
  const shell = SPORT_SHELLS.mlb
  const allPicks = shell.rounds.map((r) => ({ roundId: r.id, teamId: 'picked' }))

  it('counts an undecided round as points still available, never as a miss', () => {
    const score = scoreBracket(shell, allPicks, [], null, null)
    expect(score.earned).toBe(0)
    expect(score.correct).toBe(0)
    expect(score.decided).toBe(0)
    // 5 + 10 + 18 + 30 rounds, plus the 5-point length bonus.
    expect(score.remaining).toBe(68)
  })

  it('awards a round only when the pick matches what actually happened', () => {
    const score = scoreBracket(
      shell,
      allPicks,
      [
        { roundId: 'wc', teamId: 'picked' },
        { roundId: 'ds', teamId: 'someone-else' },
      ],
      null,
      null,
    )
    expect(score.earned).toBe(5)
    expect(score.correct).toBe(1)
    expect(score.decided).toBe(2)
    // Championship + World Series + the bonus are still live.
    expect(score.remaining).toBe(53)
  })

  it('pays the length bonus only for an exact call', () => {
    const results = shell.rounds.map((r) => ({ roundId: r.id, teamId: 'picked' }))
    const exact = scoreBracket(shell, allPicks, results, 6, 6)
    expect(exact.lengthBonusEarned).toBe(5)
    expect(exact.earned).toBe(68)

    const wrong = scoreBracket(shell, allPicks, results, 7, 6)
    expect(wrong.lengthBonusEarned).toBe(0)
    expect(wrong.earned).toBe(63)
  })

  it('holds the length bonus open while the final is undecided', () => {
    const results = shell.rounds.map((r) => ({ roundId: r.id, teamId: 'picked' }))
    const pending = scoreBracket(shell, allPicks, results, 6, null)
    expect(pending.lengthBonusEarned).toBe(0)
    // Still reachable — an undecided series is not a wrong answer.
    expect(pending.remaining).toBe(5)
  })

  it('does not pay a bonus to someone who never called a length', () => {
    const results = shell.rounds.map((r) => ({ roundId: r.id, teamId: 'picked' }))
    expect(scoreBracket(shell, allPicks, results, null, 6).lengthBonusEarned).toBe(0)
  })
})
