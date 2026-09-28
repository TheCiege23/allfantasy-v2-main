import { describe, expect, it } from 'vitest'
import { leagueWeekProgress } from '@/lib/core-app/leagueWeekProgress'

describe('completed fantasy weeks', () => {
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
