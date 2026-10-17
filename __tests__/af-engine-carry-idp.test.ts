import { describe, expect, it } from 'vitest'

import { afEngineForLeague } from '@/lib/core-app/afEngineCarry'
import { formatLockLabel } from '@/lib/core-app/lockLabel'
import { kickoffClock } from '@/lib/core-app/lineupLock'

/*
 * The AF engine scores a defender on his defensive components, so his engine number is
 * IDP points, not PPR. The provider's generic column is offensive-only and reads a sliver
 * for the same player, so league/generic was a ~12x multiplier — the live screen showed a
 * DL at 95.2 against a provider line of 10.0.
 */
describe('afEngineForLeague — defenders are not carried by the PPR ratio', () => {
  it('reproduces the inflation when the row is passed as a bare number (the pre-fix call shape)', () => {
    // Engine 8 IDP points, provider generic 0.84 (offensive-only column), league 10.0.
    expect(afEngineForLeague(8, 0.84, 10)).toBeCloseTo(95.24, 2)
  })

  it('returns a defender unscaled when the engine basis is IDP-scored', () => {
    expect(afEngineForLeague({ projectedPoints: 8, basis: 'weekly_idp_components' }, 0.84, 10)).toBe(8)
    expect(afEngineForLeague({ projectedPoints: 8, basis: 'sleeper_weekly_idp_projection' }, 0.84, 10)).toBe(8)
  })

  it('returns a defender unscaled on position alone when the basis is missing', () => {
    expect(afEngineForLeague({ projectedPoints: 8, basis: null, position: 'DL' }, 0.84, 10)).toBe(8)
    expect(afEngineForLeague({ projectedPoints: 8, position: 'cb' }, 0.84, 10)).toBe(8)
  })

  it('still carries an offensive player into the league by the provider ratio', () => {
    // 6-point passing TDs: provider 18 PPR -> 22.5 league; engine 20 -> 25.
    const row = { projectedPoints: 20, basis: 'sleeper_weekly_projection', position: 'QB' }
    expect(afEngineForLeague(row, 18, 22.5)).toBe(25)
    expect(afEngineForLeague(20, 18, 22.5)).toBe(25)
  })

  it('keeps the existing null and no-ratio behaviour', () => {
    expect(afEngineForLeague(null, 10, 12)).toBeNull()
    expect(afEngineForLeague({ projectedPoints: Number.NaN, position: 'WR' }, 10, 12)).toBeNull()
    expect(afEngineForLeague({ projectedPoints: 9.5, position: 'WR' }, null, null)).toBe(9.5)
  })
})

/*
 * Kickoffs printed in UTC moved every night game to the next day: Sunday night read "Mon",
 * Monday night read "Tue". The schedule's day is Eastern.
 */
describe('kickoff labels read on the schedule clock, not UTC', () => {
  it('a Sunday-night kickoff is Sunday', () => {
    // 2026-10-05T00:20Z is Sun Oct 4, 8:20 PM EDT.
    expect(kickoffClock('2026-10-05T00:20:00Z')).toBe('Sun 8:20p ET')
  })

  it('the distant-lock date on the board is the Eastern day', () => {
    const now = Date.parse('2026-10-02T12:00:00Z')
    const label = formatLockLabel(Date.parse('2026-10-26T00:20:00Z'), now)
    expect(label.distant).toBe(true)
    expect(label.text).toBe('Oct 25')
  })
})
