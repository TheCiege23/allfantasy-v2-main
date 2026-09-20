import { describe, expect, it } from 'vitest'

import {
  SPORT_INTRO_ELIGIBLE_CONCEPTS,
  resolveSportLeagueIntro,
} from '@/lib/league-media/sportLeagueIntros'

describe('resolveSportLeagueIntro', () => {
  it('serves the sport-native clip for generic formats', () => {
    expect(resolveSportLeagueIntro({ sport: 'MLB', conceptKey: 'redraft' })?.video).toBe(
      '/media/league-intros/sports/Baseball.mp4',
    )
    expect(resolveSportLeagueIntro({ sport: 'NHL', conceptKey: 'dynasty' })?.video).toBe(
      '/media/league-intros/sports/Hockey.mp4',
    )
    expect(resolveSportLeagueIntro({ sport: 'SOCCER', conceptKey: 'keeper' })?.video).toBe(
      '/media/league-intros/sports/Soccer.mp4',
    )
    expect(resolveSportLeagueIntro({ sport: 'NFL', conceptKey: 'best_ball' })?.video).toBe(
      '/media/league-intros/sports/Football.mp4',
    )
    expect(resolveSportLeagueIntro({ sport: 'NCAAF', conceptKey: 'idp' })?.video).toBe(
      '/media/league-intros/sports/Football.mp4',
    )
  })

  it('leaves every themed concept alone, whatever the sport', () => {
    for (const concept of ['zombie', 'guillotine', 'survivor', 'big_brother', 'c2c', 'devy', 'tournament']) {
      for (const sport of ['MLB', 'NHL', 'SOCCER', 'NFL']) {
        expect(resolveSportLeagueIntro({ sport, conceptKey: concept })).toBeNull()
      }
    }
  })

  it('returns null for a sport with no shipped clip, so the concept intro still plays', () => {
    expect(resolveSportLeagueIntro({ sport: 'NBA', conceptKey: 'redraft' })).toBeNull()
    expect(resolveSportLeagueIntro({ sport: 'NCAAB', conceptKey: 'redraft' })).toBeNull()
  })

  it('fails closed on junk input', () => {
    expect(resolveSportLeagueIntro({ sport: null, conceptKey: 'redraft' })).toBeNull()
    expect(resolveSportLeagueIntro({ sport: '', conceptKey: 'redraft' })).toBeNull()
    expect(resolveSportLeagueIntro({ sport: 'QUIDDITCH', conceptKey: 'redraft' })).toBeNull()
    expect(resolveSportLeagueIntro({ sport: 'MLB', conceptKey: null })).toBeNull()
    expect(resolveSportLeagueIntro({ sport: 'MLB', conceptKey: 'not_a_concept' })).toBeNull()
  })

  it('normalizes sport casing and whitespace', () => {
    expect(resolveSportLeagueIntro({ sport: ' mlb ', conceptKey: 'redraft' })?.video).toBe(
      '/media/league-intros/sports/Baseball.mp4',
    )
  })

  it('labels the clip by sport, not by concept', () => {
    expect(resolveSportLeagueIntro({ sport: 'MLB', conceptKey: 'redraft' })?.label).toBe('Baseball')
    expect(resolveSportLeagueIntro({ sport: 'NHL', conceptKey: 'salary_cap' })?.label).toBe('Hockey')
  })

  it('eligible set is exactly the six generic formats', () => {
    expect([...SPORT_INTRO_ELIGIBLE_CONCEPTS].sort()).toEqual([
      'best_ball',
      'dynasty',
      'idp',
      'keeper',
      'redraft',
      'salary_cap',
    ])
  })
})
