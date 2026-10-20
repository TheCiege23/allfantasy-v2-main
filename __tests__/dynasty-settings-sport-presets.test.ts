import { describe, expect, it } from 'vitest'
import { getDynastyPlayoffPresetList } from '@/lib/dynasty-core/DynastyPlayoffPresets'
import { isDynastyFootballSport } from '@/lib/dynasty-core/constants'

describe('dynasty settings presets are sport-aware', () => {
  it('suggests a week-15 playoff start for football only', () => {
    for (const p of getDynastyPlayoffPresetList('NFL')) expect(p.playoffStartWeek).toBe(15)
    for (const sport of ['NBA', 'MLB', 'NHL']) {
      // null tells the settings PUT to keep the league's own start week instead of writing 15.
      for (const p of getDynastyPlayoffPresetList(sport)) expect(p.playoffStartWeek).toBeNull()
    }
  })

  it('treats only NFL and NCAAF as football formats', () => {
    expect(isDynastyFootballSport('NFL')).toBe(true)
    expect(isDynastyFootballSport('ncaaf')).toBe(true)
    expect(isDynastyFootballSport('MLB')).toBe(false)
    expect(isDynastyFootballSport('NBA')).toBe(false)
    expect(isDynastyFootballSport('NHL')).toBe(false)
  })
})
