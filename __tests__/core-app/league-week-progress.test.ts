import { describe, expect, it } from 'vitest'
import { currentScheduledLeagueWeek, leagueWeekProgress } from '@/lib/core-app/leagueWeekProgress'

describe('completed fantasy weeks', () => {
  it('advances a finished NFL marker only to an immediately scheduled week in the active season', () => {
    const league = { season: 2026, sport: 'NFL', status: 'in_season', settings: { current_week: 4 } }
    const finished = new Set(['2026:4'])
    expect(currentScheduledLeagueWeek(league, 2026, [4, 5, 18], finished)).toBe(5)
    expect(currentScheduledLeagueWeek(league, 2026, [4, 18], finished)).toBe(4)
    expect(currentScheduledLeagueWeek(league, 2026, [4, 5])).toBe(4)
    expect(currentScheduledLeagueWeek(league, 2026, [4, 5], new Set(['2025:4']))).toBe(4)
    expect(currentScheduledLeagueWeek(league, 2025, [4, 5], finished)).toBe(4)
    expect(currentScheduledLeagueWeek({ ...league, status: 'complete' }, 2026, [4, 5], finished)).toBe(4)
    for (const sport of ['NBA', 'MLB', 'NHL', 'NCAAB', 'NCAAF', 'SOCCER']) {
      expect(currentScheduledLeagueWeek({ ...league, sport }, 2026, [4, 5], finished)).toBe(4)
    }
  })
  it('prefers refreshed canonical period metadata over an older raw leg marker', () => {
    expect(leagueWeekProgress({ season: 2026, settings: { leg: 2, current_week: 3 } }).currentWeek).toBe(3)
  })
  it('does not count Thursday scores as a completed current week', () => {
    const p = leagueWeekProgress({ season: 2026, settings: { leg: 3 } })
    expect(p.currentWeek).toBe(3)
    expect(p.isFinal(2026, 2)).toBe(true)
    expect(p.isFinal(2026, 3)).toBe(false)
    expect(p.isFinal(2026, 4)).toBe(false)
    expect(p.isFinal(2025, 17)).toBe(true)
    expect(p.isFinal(2027, 1)).toBe(false)
  })
  it('includes the last week when the provider marks the season complete', () => {
    expect(leagueWeekProgress({ season: 2026, settings: { leg: 17 }, status: 'complete' }).isFinal(2026, 17)).toBe(true)
  })
  it('does not invent completion when current-week metadata is missing', () => {
    expect(leagueWeekProgress({ season: 2026 }).isFinal(2026, 3)).toBe(false)
  })
})

describe('the schedule says the current week is played (Tuesday, Sleeper still on it)', () => {
  const finished = new Set(['2026:3'])

  it('an NFL league\'s current week is final once every game in it is', () => {
    const p = leagueWeekProgress({ season: 2026, sport: 'NFL', settings: { leg: 3 } }, finished)
    expect(p.isFinal(2026, 3)).toBe(true)
    // Never a week ahead of the league's marker — the schedule cannot speak for it.
    expect(p.isFinal(2026, 4)).toBe(false)
  })

  it('not for a league in another sport, and not without the schedule fact', () => {
    expect(leagueWeekProgress({ season: 2026, sport: 'NBA', settings: { leg: 3 } }, finished).isFinal(2026, 3)).toBe(false)
    expect(leagueWeekProgress({ season: 2026, sport: 'NFL', settings: { leg: 3 } }).isFinal(2026, 3)).toBe(false)
    expect(leagueWeekProgress({ season: 2026, sport: 'NFL', settings: { leg: 3 } }, new Set(['2025:3'])).isFinal(2026, 3)).toBe(false)
  })
})
