/**
 * The running season follows the commissioner's playoff start week (lib/schedule-runtime/seasonPlayoffStartSync.ts,
 * 2026-11-15). The setting was saved on the league while the season ran on its own copy, which nothing updated.
 */
import { describe, expect, it } from 'vitest'

import { planSeasonPlayoffStartSync } from '@/lib/schedule-runtime/seasonPlayoffStartSync'
import { regularSeasonWeeksFrom } from '@/app/league/[leagueId]/components/settings/ScheduleSettingsPanel'

const season = (over: Partial<{ status: string; currentWeek: number; totalWeeks: number; playoffStartWeek: number }> = {}) => ({
  id: 's1', status: 'active', currentWeek: 0, totalWeeks: 17, playoffStartWeek: 15, ...over,
})

describe('a new playoff start week', () => {
  it('before week 1, moves the season and keeps the playoff length', () => {
    expect(planSeasonPlayoffStartSync(season(), 14, false)).toEqual({ kind: 'apply', seasonId: 's1', playoffStartWeek: 14, totalWeeks: 16, midSeason: false })
  })

  it('mid-season, asks first, then applies', () => {
    expect(planSeasonPlayoffStartSync(season({ currentWeek: 6 }), 16, false)).toEqual({ kind: 'needs_confirmation' })
    expect(planSeasonPlayoffStartSync(season({ currentWeek: 6 }), 16, true)).toMatchObject({ kind: 'apply', playoffStartWeek: 16, totalWeeks: 18, midSeason: true })
  })

  it('never into a week that has begun', () => {
    const plan = planSeasonPlayoffStartSync(season({ currentWeek: 9 }), 9, true)
    expect(plan.kind).toBe('refuse_past')
    expect((plan as { message: string }).message).toMatch(/week 10 at the earliest/)
  })

  it('nothing to do: same week, no season, or a finished season', () => {
    expect(planSeasonPlayoffStartSync(season(), 15, false)).toEqual({ kind: 'none' })
    expect(planSeasonPlayoffStartSync(null, 14, false)).toEqual({ kind: 'none' })
    expect(planSeasonPlayoffStartSync(season({ status: 'completed' }), 14, false)).toEqual({ kind: 'none' })
  })
})

describe('the Schedule tab\'s regular season length', () => {
  it('is the weeks before the playoffs', () => {
    expect(regularSeasonWeeksFrom(15, 10)).toBe(14)
    expect(regularSeasonWeeksFrom(null, 12)).toBe(12)
    expect(regularSeasonWeeksFrom(null, undefined)).toBe(14)
  })
})
