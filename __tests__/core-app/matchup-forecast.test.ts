// @vitest-environment node
/**
 * `forecastMatchup` — the one set of rules both matchup screens use for a win probability.
 *
 * 🛑 WHY IT EXISTS: on 2026-10-02 the all-leagues board said 98% and the league page said "—" for
 * the same game, because each applied its own rules to the same engine. Every rule is pinned here,
 * each with the case that would break it.
 */
import { describe, expect, it } from 'vitest'
import { forecastMatchup, matchupStarted, type ForecastSide, type ForecastStarter } from '@/lib/core-app/matchupForecast'

const s = (playerId: string, projected: number | null, over: Partial<ForecastStarter> = {}): ForecastStarter => ({
  playerId,
  projected,
  actual: 0,
  state: 'upcoming',
  ...over,
})
const side = (starters: ForecastStarter[], over: Partial<ForecastSide> = {}): ForecastSide => ({
  starters,
  teamPoints: 0,
  hasPlayerPoints: false,
  ...over,
})

describe('forecastMatchup', () => {
  it('CONTROL: two priced lineups before kickoff give a probability', () => {
    const r = forecastMatchup(side([s('a', 20), s('b', 15)]), side([s('c', 10), s('d', 10)]))
    expect(r.available).toBe(true)
    if (r.available) expect(r.pWin).toBeGreaterThan(0.5)
  })

  it('🛑 an empty slot is a certain zero, not an unpriced starter', () => {
    const withHole = forecastMatchup(side([s('a', 20), s('0', null)]), side([s('c', 10), s('d', 10)]))
    expect(withHole.available).toBe(true)
    /* …and it is worth exactly nothing: the same as the lineup without it. */
    const without = forecastMatchup(side([s('a', 20)]), side([s('c', 10), s('d', 10)]))
    expect(withHole.available && without.available && withHole.pWin).toBe(without.available ? without.pWin : NaN)
  })

  it('a ruled-out starter is a certain zero even with no projection', () => {
    const r = forecastMatchup(side([s('a', 20), s('hurt', null, { unavailable: true })]), side([s('c', 10)]))
    expect(r.available).toBe(true)
  })

  it('🛑 an unpriced starter still to play refuses, and says how many', () => {
    const r = forecastMatchup(side([s('a', 20), s('x', null)]), side([s('c', 10), s('y', null)]))
    expect(r).toMatchObject({ available: false, refusal: 'unprojected' })
    expect(!r.available && r.reason).toMatch(/^2 starters could not be priced/)
  })

  it('🛑 before kickoff an unknown game state does not refuse — nothing is banked yet', () => {
    const r = forecastMatchup(side([s('a', 20, { state: 'unknown' })]), side([s('c', 10)]))
    expect(r.available).toBe(true)
  })

  it('after kickoff an unknown game state refuses', () => {
    const r = forecastMatchup(
      side([s('a', 20, { state: 'unknown' }), s('b', 5, { state: 'final', actual: 7 })], { teamPoints: 7, hasPlayerPoints: true }),
      side([s('c', 10)]),
    )
    expect(r).toMatchObject({ available: false, refusal: 'states_unknown' })
  })

  it('points on the board with no per-player rows refuse — per side', () => {
    const r = forecastMatchup(side([s('a', 20)], { teamPoints: 12, hasPlayerPoints: false }), side([s('c', 10)]))
    expect(r).toMatchObject({ available: false, refusal: 'unattributed' })
  })

  it('a FINISHED starter with no projection does not refuse — his points are banked', () => {
    const r = forecastMatchup(
      side([s('a', 20), s('k', null, { state: 'final', actual: 9 })], { teamPoints: 9, hasPlayerPoints: true }),
      side([s('c', 10)]),
    )
    expect(r.available).toBe(true)
  })

  it('banks scoreboard points no player row accounts for, exactly once', () => {
    const attributed = forecastMatchup(
      side([s('a', 10, { state: 'final', actual: 30 })], { teamPoints: 30, hasPlayerPoints: true }),
      side([s('c', 10, { state: 'final', actual: 20 })], { teamPoints: 20, hasPlayerPoints: true }),
    )
    const extra = forecastMatchup(
      side([s('a', 10, { state: 'final', actual: 30 })], { teamPoints: 35, hasPlayerPoints: true }),
      side([s('c', 10, { state: 'final', actual: 20 })], { teamPoints: 20, hasPlayerPoints: true }),
    )
    expect(attributed.available && attributed.projectedMargin).toBe(10)
    expect(extra.available && extra.projectedMargin).toBe(15)
  })

  it('best ball and a league with no rules refuse before anything else', () => {
    expect(forecastMatchup(side([s('a', 1)]), side([s('c', 1)]), { bestBall: true })).toMatchObject({ refusal: 'best_ball' })
    expect(forecastMatchup(side([s('a', 1)]), side([s('c', 1)]), { noRulesReason: 'no rules' })).toMatchObject({
      refusal: 'no_rules',
      reason: 'no rules',
    })
  })

  it('a side with only empty slots has no starters', () => {
    expect(forecastMatchup(side([s('0', null)]), side([s('c', 1)]))).toMatchObject({ refusal: 'no_starters' })
  })
})

describe('matchupStarted', () => {
  it('is false before kickoff, whatever a stale schedule says about a ruled-out starter', () => {
    expect(matchupStarted(side([s('a', 1), s('h', 0, { unavailable: true, state: 'final' })]), side([s('c', 1)]))).toBe(false)
  })
  it('is true once anything is banked or any game is live', () => {
    expect(matchupStarted(side([s('a', 1)], { teamPoints: 0.5 }), side([s('c', 1)]))).toBe(true)
    expect(matchupStarted(side([s('a', 1, { state: 'live' })]), side([s('c', 1)]))).toBe(true)
  })
})
