import { describe, expect, it } from 'vitest'
import { getZombieCreationProfile, getZombieCreationTeamCounts, zombieCreationLeagueCount } from '@/lib/zombie/creationPolicy'
import { getDefaultTeamCount, getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import { getZombieTeamCountOptionsForSport } from '@/lib/league-creation-wizard/sport-team-limits'
import { getZombieSeasonSchedule, getCurrentPhase } from '@/lib/zombie/zombieSeasonSchedule'
import { getZombieUniverseLevelPlanForCount } from '@/lib/zombie/zombie-universe-tier'
import { resolveCreatedSeasonWeeks } from '@/lib/redraft/createdSeasonLength'
import type { SupportedSport } from '@/lib/create-league-v2/state'

const profiles: Array<[SupportedSport, number, number, string]> = [
  ['NFL', 18, 20, 'fb_half_ppr'], ['NBA', 25, 28, 'nba_points'], ['NHL', 28, 30, 'nhl_points'],
  ['MLB', 27, 30, 'mlb_points'], ['NCAAF', 15, 18, 'ncaaf_half_ppr'],
  ['NCAAB', 18, 20, 'ncaab_points'], ['SOCCER', 38, 40, 'soc_points'],
]
describe('Zombie manager capacity and season planning', () => {
  it.each(profiles)('%s defaults to 20 and accepts every size shown by either wizard', (sport, periods, suggested, scoringPreset) => {
    const counts = getZombieCreationTeamCounts(sport)
    expect(getDefaultTeamCount(sport, 'zombie')).toBe(20)
    expect(getTeamCountOptions(sport, 'zombie')).toEqual(counts)
    expect(getZombieTeamCountOptionsForSport(sport)).toEqual(counts)
    expect(counts[0]).toBe(4)
    expect(counts.at(-1)).toBe(sport === 'NFL' ? 20 : sport === 'SOCCER' ? 40 : 32)
    expect(getZombieCreationProfile(sport)).toMatchObject({ scoringPeriods: periods, suggestedManagers: suggested })
    for (const teamCount of counts) {
      const result = validateCreatePayload({ concept: 'zombie', sport, scoringPreset, teamCount,
        draftType: 'snake', leagueName: 'Capacity check', ...(sport === 'SOCCER' ? { soccerPipeline: 'euro' } : {}) })
      expect(result.ok, JSON.stringify(result)).toBe(true)
    }
    expect(resolveCreatedSeasonWeeks({ leagueType: 'zombie', sport }, 13)).toBe(periods)
    expect(getZombieSeasonSchedule(sport)).toMatchObject({ totalWeeks: periods, defaultTeamCount: 20 })
    expect(getCurrentPhase(sport, periods)).toBe('finale')
    expect(getCurrentPhase(sport, periods + 1)).toBe('complete')
  })
  it.each([3, 5, 21, 22, 32])('rejects invalid NFL size %s rather than silently creating 12 teams', teamCount => {
    expect(validateCreatePayload({ concept: 'zombie', sport: 'NFL', scoringPreset: 'fb_half_ppr',
      teamCount, draftType: 'snake', leagueName: 'Invalid capacity' }).ok).toBe(false)
  })
  it.each([0, 7, 2.5, '6', null])('rejects an invalid universe count %s before creation', zombieLeagueCount => {
    expect(validateCreatePayload({ concept: 'zombie', sport: 'NFL', scoringPreset: 'fb_half_ppr',
      teamCount: 20, draftType: 'snake', leagueName: 'Invalid batch', conceptSetup: { zombieLeagueCount } }).ok).toBe(false)
  })
  it('offers all six universe sizes and keeps existing tier layouts', () => {
    for (let count = 1; count <= 6; count++) {
      expect(zombieCreationLeagueCount({ zombieLeagueCount: count })).toBe(count)
      expect(getZombieUniverseLevelPlanForCount(count).reduce((n, level) => n + level.leagueSlots, 0)).toBe(count)
    }
    expect(zombieCreationLeagueCount(undefined)).toBe(1)
    expect(getZombieUniverseLevelPlanForCount(6).map(level => level.leagueSlots)).toEqual([1, 2, 3])
  })
  it('leaves ordinary redraft season sizing unchanged', () => {
    expect(resolveCreatedSeasonWeeks({ leagueType: 'redraft', sport: 'NFL' }, 17)).toBe(17)
  })
})
