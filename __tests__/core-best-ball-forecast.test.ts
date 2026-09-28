import { describe, expect, it } from 'vitest'
import { bestBallProjectedFinal, optimizeBestBall } from '../lib/core-app/bestBallForecast'

describe('Best Ball full-roster forecast', () => {
  it('assigns the best eligible bench players without using one player twice', () => {
    const selected = optimizeBestBall(['QB', 'RB', 'FLEX'], [
      { playerId: 'hurt-qb', position: 'QB', expected: 0, banked: 0 },
      { playerId: 'bench-qb', position: 'QB', expected: 24, banked: 0 },
      { playerId: 'rb-one', position: 'RB', expected: 20, banked: 0 },
      { playerId: 'rb-two', position: 'RB', expected: 15, banked: 0 },
      { playerId: 'wr-one', position: 'WR', expected: 12, banked: 0 },
    ])
    expect(selected?.map((p) => p.playerId)).toEqual(['bench-qb', 'rb-one', 'rb-two'])
  })

  it('ignores IR and taxi players and refuses an uncovered slot', () => {
    const result = bestBallProjectedFinal({
      slots: ['QB', 'RB'],
      candidates: [
        { playerId: 'qb', position: 'QB', projected: 19, unavailable: null, inactive: false },
        { playerId: 'ir-rb', position: 'RB', projected: 24, unavailable: null, inactive: true },
      ],
      actualBy: null,
      stateBy: new Map([['qb', 'upcoming'], ['ir-rb', 'upcoming']]),
      scoreboard: 0,
    })
    expect(result).toEqual({ available: false, reason: 'eligible roster players cannot fill every starting slot' })
  })

  it('uses a final bench score and projected upcoming players in one legal lineup', () => {
    const result = bestBallProjectedFinal({
      slots: ['QB', 'RB'],
      candidates: [
        { playerId: 'qb', position: 'QB', projected: 20, unavailable: null, inactive: false },
        { playerId: 'starter-rb', position: 'RB', projected: 0, unavailable: 'out', inactive: false },
        { playerId: 'bench-rb', position: 'RB', projected: 10, unavailable: null, inactive: false },
      ],
      actualBy: new Map([['bench-rb', 17], ['starter-rb', 0]]),
      stateBy: new Map([['qb', 'upcoming'], ['starter-rb', 'final'], ['bench-rb', 'final']]),
      scoreboard: 17,
    })
    expect(result).toEqual({ available: true, total: 37, selected: ['qb', 'bench-rb'] })
  })

  it('does not turn a missing bench projection into zero', () => {
    const result = bestBallProjectedFinal({
      slots: ['QB'],
      candidates: [
        { playerId: 'qb', position: 'QB', projected: 20, unavailable: null, inactive: false },
        { playerId: 'bench', position: 'QB', projected: null, unavailable: null, inactive: false },
      ],
      actualBy: null,
      stateBy: new Map([['qb', 'upcoming'], ['bench', 'upcoming']]),
      scoreboard: 0,
    })
    expect(result.available).toBe(false)
  })

  it('prices a verified bye at zero without requiring a game state', () => {
    const result = bestBallProjectedFinal({
      slots: ['QB'],
      candidates: [
        { playerId: 'bye', position: 'QB', projected: 0, unavailable: 'bye', inactive: false },
        { playerId: 'active', position: 'QB', projected: 21, unavailable: null, inactive: false },
      ],
      actualBy: null,
      stateBy: new Map([['active', 'upcoming']]),
      scoreboard: 0,
    })
    expect(result).toEqual({ available: true, total: 21, selected: ['active'] })
  })

  it('does not add the live scoreboard to a different projected legal lineup', () => {
    const result = bestBallProjectedFinal({
      slots: ['QB'],
      candidates: [
        { playerId: 'scored', position: 'QB', projected: 10, unavailable: null, inactive: false },
        { playerId: 'future', position: 'QB', projected: 20, unavailable: null, inactive: false },
      ],
      actualBy: new Map([['scored', 10]]),
      stateBy: new Map([['scored', 'final'], ['future', 'upcoming']]),
      scoreboard: 10,
    })
    expect(result).toEqual({ available: true, total: 20, selected: ['future'] })
  })
})
