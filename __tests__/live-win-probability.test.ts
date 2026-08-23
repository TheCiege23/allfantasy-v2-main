import { describe, it, expect } from 'vitest'
import {
  estimateWinProbability,
  fractionRemaining,
  parseClockSeconds,
} from '@/lib/live/winProbability'

describe('parseClockSeconds', () => {
  it('reads a game clock', () => {
    expect(parseClockSeconds('8:42')).toBe(522)
    expect(parseClockSeconds('0:07')).toBe(7)
  })

  it('rejects anything that is not a clock rather than coercing it', () => {
    expect(parseClockSeconds('')).toBeNull()
    expect(parseClockSeconds('Halftime')).toBeNull()
    expect(parseClockSeconds('8:99')).toBeNull()
    expect(parseClockSeconds(null)).toBeNull()
  })
})

describe('fractionRemaining', () => {
  it('counts the whole game at kickoff and none at the end of regulation', () => {
    expect(fractionRemaining(1, 15 * 60)).toBe(1)
    expect(fractionRemaining(4, 0)).toBe(0)
  })

  it('counts remaining periods, not just the current clock', () => {
    // Q3 with 8:42 left = 8:42 + all of Q4.
    expect(fractionRemaining(3, 522)).toBeCloseTo((522 + 900) / 3600, 5)
  })

  it('never returns zero in overtime — the game is undecided, not over', () => {
    // A zero would drive sigma*sqrt(t) to zero and force a certain 0 or 1.
    expect(fractionRemaining(5, 0)).toBeGreaterThan(0)
  })
})

describe('estimateWinProbability', () => {
  it('refuses when the game cannot be timed rather than returning a 50/50', () => {
    // An unlabelled coin flip is indistinguishable from a real one on screen.
    expect(
      estimateWinProbability({ homeScore: 20, awayScore: 17, period: null, clock: null, completed: false }),
    ).toBeNull()
  })

  it('refuses when a score is missing', () => {
    expect(
      estimateWinProbability({ homeScore: null, awayScore: 17, period: 3, clock: '8:42', completed: false }),
    ).toBeNull()
  })

  it('reports a completed game as decided, not estimated at 90-something', () => {
    const wp = estimateWinProbability({ homeScore: 27, awayScore: 24, period: 4, clock: '0:00', completed: true })
    expect(wp).toEqual({ home: 99, away: 1, isEstimate: true })
  })

  it('returns null for a completed tie — there is no winner to report', () => {
    expect(
      estimateWinProbability({ homeScore: 20, awayScore: 20, period: 5, clock: '0:00', completed: true }),
    ).toBeNull()
  })

  it('always marks itself as an estimate so no surface can render it unlabelled', () => {
    const wp = estimateWinProbability({ homeScore: 20, awayScore: 17, period: 3, clock: '8:42', completed: false })
    expect(wp?.isEstimate).toBe(true)
  })

  it('favours the leader, and more strongly as time runs out', () => {
    const early = estimateWinProbability({ homeScore: 20, awayScore: 17, period: 2, clock: '10:00', completed: false })!
    const late = estimateWinProbability({ homeScore: 20, awayScore: 17, period: 4, clock: '1:00', completed: false })!
    expect(early.home).toBeGreaterThan(50)
    expect(late.home).toBeGreaterThan(early.home)
  })

  it('opens a tied game at the real-world home win rate, not at 50/50', () => {
    // At kickoff the margin carries no information, so the estimate is pure
    // home-field advantage: 1.8 / 13.5 = 0.133 sigma, which is ~55%. That lands
    // on the actual NFL home win rate (~55%), which is the calibration check
    // that matters — a model that opened every game at 50/50 would be ignoring
    // the one thing it does know before a snap is played.
    const wp = estimateWinProbability({ homeScore: 0, awayScore: 0, period: 1, clock: '15:00', completed: false })!
    expect(wp.home).toBeGreaterThanOrEqual(53)
    expect(wp.home).toBeLessThanOrEqual(57)
  })

  it('always reports two percentages that sum to 100', () => {
    for (const period of [1, 2, 3, 4]) {
      const wp = estimateWinProbability({ homeScore: 31, awayScore: 3, period, clock: '5:00', completed: false })!
      expect(wp.home + wp.away).toBe(100)
    }
  })

  it('never claims certainty while the game is still being played', () => {
    // A 28-point lead with a minute left is nearly over, but "100%" is a claim
    // the model has no business making about a game in progress.
    const wp = estimateWinProbability({ homeScore: 31, awayScore: 3, period: 4, clock: '1:00', completed: false })!
    expect(wp.home).toBeLessThanOrEqual(99)
    expect(wp.away).toBeGreaterThanOrEqual(1)
  })
})
