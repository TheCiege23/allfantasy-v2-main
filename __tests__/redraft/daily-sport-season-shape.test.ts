/**
 * One season shape per daily sport, and every default reader agrees with it.
 *
 * Six files used to carry six answers; the two read live (sport config + playoff resolver) ended
 * NBA/NHL/MLB seasons 3–6 weeks before the real ones. These assert each reader against the table, so
 * a value edited in one place without the others fails here.
 */
import { describe, expect, it } from 'vitest'

import { DAILY_SPORT_SEASON_SHAPE, playoffStartWeekFor, regularSeasonWeeksFor, type DailySeasonSport } from '@/lib/sportConfig/dailySportSeasonShape'
import { getSportConfig } from '@/lib/sportConfig'
import { REDRAFT_SPORT_CONFIGS } from '@/lib/redraft/sportConfig'
import { resolveDefaultPlayoffConfig } from '@/lib/sport-defaults/DefaultPlayoffConfigResolver'
import { getDefaultLeagueSettings } from '@/lib/sport-defaults/LeagueDefaultSettingsService'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { isScoringStarterSlot } from '@/lib/redraft/scoringEngine'
import { slotCategory } from '@/lib/league-runtime/redraftSlotType'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'

const SPORTS: DailySeasonSport[] = ['NBA', 'NHL', 'MLB']

describe('daily-sport season shape', () => {
  it.each(SPORTS)('%s: every default reader agrees with the table', (sport) => {
    const shape = DAILY_SPORT_SEASON_SHAPE[sport]
    const cfg = getSportConfig(sport)
    expect(cfg.defaultSeasonWeeks).toBe(shape.totalWeeks)
    expect(cfg.defaultPlayoffStartWeek).toBe(playoffStartWeekFor(sport))
    expect(cfg.defaultPlayoffTeams).toBe(shape.playoffTeams)
    expect(resolveDefaultPlayoffConfig(sport as never).playoff_start_week).toBe(playoffStartWeekFor(sport))
    expect(getDefaultLeagueSettings(sport).regular_season_length).toBe(shape.totalWeeks)
    const redraft = REDRAFT_SPORT_CONFIGS[sport.toLowerCase()]
    expect(redraft.regularSeasonWeeks).toBe(regularSeasonWeeksFor(sport))
    expect(redraft.defaultPlayoffStartWeek).toBe(playoffStartWeekFor(sport))
  })

  it.each([
    ['NBA', 2026, '2027-04-11'],
    ['NHL', 2026, '2027-04-10'],
    ['MLB', 2027, '2027-09-26'],
  ] as const)('%s %s: the last fantasy week contains the last regular-season day (%s)', (sport, season, lastDay) => {
    const window = resolveDailySportWeekWindow(sport, season, DAILY_SPORT_SEASON_SHAPE[sport].totalWeeks)
    expect(window).not.toBeNull()
    const day = Date.parse(`${lastDay}T16:00:00Z`)
    expect(window!.start.getTime()).toBeLessThanOrEqual(day)
    expect(window!.end.getTime()).toBeGreaterThan(day)
  })
})

describe('MLB/NBA reserve slots are never starters', () => {
  it.each(['IL', 'il', 'IL_PLUS', 'NA', 'PROSPECT', 'MINORS'])('%s does not score and is not a starter', (slot) => {
    expect(isScoringStarterSlot(slot)).toBe(false)
    expect(slotCategory(slot)).not.toBe('starter')
  })

  it('an MLB roster template counts IL and NA as reserve capacity, not starters', () => {
    const settings = { roster: { config: { sections: [{ slots: { C: 1, OF: 3, BN: 6, IL: 2, NA: 1 } }] } } }
    const config = resolveRedraftRosterConfig('MLB', settings)
    expect(config.starterCapacities.has('IL')).toBe(false)
    expect(config.starterCapacities.has('NA')).toBe(false)
    expect(config.irSlots).toBe(3)
  })
})
