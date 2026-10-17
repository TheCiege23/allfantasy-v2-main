import { describe, expect, it } from 'vitest'

import { pointsAgainst, pointsFor } from '@/lib/league/syncLeagueHistory'
import type { SleeperRoster } from '@/lib/sleeper-client'

/*
 * Season points for and against from a Sleeper roster, as the history import stores them.
 *
 * `ppts` is Sleeper's POTENTIAL points — the best lineup the team could have set. It used to be returned
 * as points against whenever present, so every imported Sleeper season that carried it had the wrong PA.
 */

function roster(settings: Partial<SleeperRoster['settings']> | null): SleeperRoster {
  return { roster_id: 1, owner_id: 'u1', settings } as unknown as SleeperRoster
}

describe('Sleeper season points', () => {
  it('reads points against from fpts_against, never from potential points', () => {
    const r = roster({ fpts: 1520, fpts_decimal: 44, fpts_against: 1488, fpts_against_decimal: 12, ppts: 1801, ppts_decimal: 90 })
    expect(pointsAgainst(r)).toBeCloseTo(1488.12, 6)
    expect(pointsFor(r)).toBeCloseTo(1520.44, 6)
  })

  it('reads the same with no potential points sent', () => {
    expect(pointsAgainst(roster({ fpts_against: 1200, fpts_against_decimal: 5 }))).toBeCloseTo(1200.05, 6)
  })

  it('treats missing settings as nothing scored', () => {
    expect(pointsAgainst(roster(null))).toBe(0)
    expect(pointsFor(roster(null))).toBe(0)
    expect(pointsAgainst(roster({}))).toBe(0)
  })
})
