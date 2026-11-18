import { describe, expect, it } from 'vitest'
import { LEAGUE_SKIN_COPY, LEAGUE_SKINS, redraftSkinSport, resolveLeagueSkin } from '@/lib/league/leagueTypeSkin'

describe('resolveLeagueSkin', () => {
  it('gives each specialty format its own skin', () => {
    expect(resolveLeagueSkin({ leagueVariant: 'survivor' })).toBe('survivor')
    expect(resolveLeagueSkin({ leagueVariant: 'big_brother' })).toBe('big_brother')
    expect(resolveLeagueSkin({ leagueType: 'zombie' })).toBe('zombie')
    expect(resolveLeagueSkin({ leagueType: 'pirate' })).toBe('pirate')
    expect(resolveLeagueSkin({ leagueType: 'guillotine' })).toBe('guillotine')
    expect(resolveLeagueSkin({ leagueType: 'best_ball' })).toBe('best_ball')
    expect(resolveLeagueSkin({ leagueType: 'devy' })).toBe('devy')
    expect(resolveLeagueSkin({ leagueVariant: 'merged_devy_c2c' })).toBe('devy')
    expect(resolveLeagueSkin({ leagueType: 'salary_cap' })).toBe('salary_cap')
    expect(resolveLeagueSkin({ leagueType: 'keeper' })).toBe('keeper')
  })

  it('reads the mode flags, not only the type string', () => {
    expect(resolveLeagueSkin({ leagueType: 'redraft', guillotineMode: true })).toBe('guillotine')
    expect(resolveLeagueSkin({ leagueType: 'redraft', bestBallMode: true })).toBe('best_ball')
  })

  it('lets a specialty format win over its dynasty base', () => {
    expect(resolveLeagueSkin({ leagueType: 'pirate', isDynasty: true })).toBe('pirate')
    expect(resolveLeagueSkin({ leagueType: 'guillotine', isDynasty: true })).toBe('guillotine')
  })

  it('decides dynasty with the shared predicate, case-insensitively', () => {
    expect(resolveLeagueSkin({ leagueType: 'redraft', isDynasty: true })).toBe('dynasty')
    expect(resolveLeagueSkin({ leagueVariant: 'DYNASTY_IDP' })).toBe('dynasty')
    expect(resolveLeagueSkin({ format: 'dynasty' })).toBe('dynasty')
  })

  it('falls back to redraft', () => {
    expect(resolveLeagueSkin({ leagueType: 'redraft' })).toBe('redraft')
    expect(resolveLeagueSkin({})).toBe('redraft')
    expect(resolveLeagueSkin(null)).toBe('redraft')
  })

  it('has copy for every skin', () => {
    for (const skin of LEAGUE_SKINS) {
      expect(LEAGUE_SKIN_COPY[skin].label.length).toBeGreaterThan(0)
      expect(LEAGUE_SKIN_COPY[skin].tagline.length).toBeGreaterThan(0)
    }
  })
})

describe('redraftSkinSport', () => {
  it('maps known sports and falls back to NFL', () => {
    expect(redraftSkinSport('NBA')).toBe('nba')
    expect(redraftSkinSport('soccer')).toBe('soccer')
    expect(redraftSkinSport('cricket')).toBe('nfl')
    expect(redraftSkinSport(null)).toBe('nfl')
  })
})
