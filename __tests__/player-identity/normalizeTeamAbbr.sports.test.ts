import { describe, expect, it } from 'vitest'
import {
  buildStrictPlayerKey,
  normalizeTeamAbbr,
  sportSegmentForIdentityKeys,
} from '@/lib/player-identity/playerIdentityResolution'

describe('normalizeTeamAbbr sport-aware aliases', () => {
  it('NBA: PHO and PHX normalize to the same code', () => {
    expect(normalizeTeamAbbr('PHO', 'NBA')).toBe(normalizeTeamAbbr('PHX', 'NBA'))
    expect(normalizeTeamAbbr('PHX', 'NBA')).toBe('PHX')
  })

  it('MLB: WAS and WSH normalize to WSH; LA aliases to LAD', () => {
    expect(normalizeTeamAbbr('WSH', 'MLB')).toBe('WSH')
    expect(normalizeTeamAbbr('WAS', 'MLB')).toBe('WSH')
    expect(normalizeTeamAbbr('LA', 'MLB')).toBe('LAD')
    expect(normalizeTeamAbbr('LAD', 'MLB')).toBe('LAD')
  })

  it('NHL: TB maps to TBL; LA maps to LAK (not NFL LAR)', () => {
    expect(normalizeTeamAbbr('TB', 'NHL')).toBe('TBL')
    expect(normalizeTeamAbbr('LA', 'NHL')).toBe('LAK')
    expect(normalizeTeamAbbr('LV', 'NHL')).toBe('VGK')
  })

  it('Soccer: LAFC does not alias to LA Galaxy; LA maps to LAG', () => {
    expect(normalizeTeamAbbr('LAFC', 'SOCCER')).toBe('LAFC')
    expect(normalizeTeamAbbr('LAF', 'SOCCER')).toBe('LAFC')
    expect(normalizeTeamAbbr('LAG', 'SOCCER')).toBe('LAG')
    expect(normalizeTeamAbbr('LA', 'SOCCER')).toBe('LAG')
    const lafcKey = buildStrictPlayerKey({
      name: 'Denis Bouanga',
      position: 'F',
      team: 'LAFC',
      sport: 'SOCCER',
    })
    const lagKey = buildStrictPlayerKey({
      name: 'Some Galaxy Player',
      position: 'F',
      team: 'LAG',
      sport: 'SOCCER',
    })
    expect(lafcKey).not.toBe(lagKey)
  })

  it('Soccer: INTER MIAMI normalizes to MIA', () => {
    expect(normalizeTeamAbbr('INTER MIAMI', 'SOCCER')).toBe('MIA')
  })

  it('NCAAF: conservative uppercase/trim only — no college alias table', () => {
    expect(normalizeTeamAbbr(' osu ', 'NCAAF')).toBe('OSU')
    expect(normalizeTeamAbbr('Ohio State', 'NCAAF')).toBe('OHIO STATE')
  })

  it('PGA/NASCAR/WWE: team ignored for identity normalization', () => {
    expect(normalizeTeamAbbr('CUTLINE', 'PGA')).toBe('')
    expect(normalizeTeamAbbr('ROW48', 'NASCAR')).toBe('')
    expect(normalizeTeamAbbr('RAW', 'WWE')).toBe('')
  })

  it('Cricket: uppercase trim only, no aggressive franchise mapping', () => {
    expect(normalizeTeamAbbr(' eng ', 'CRICKET')).toBe('ENG')
  })

  it('NFL aliases unchanged', () => {
    expect(normalizeTeamAbbr('JAC', 'NFL')).toBe('JAX')
    expect(normalizeTeamAbbr('LA', 'NFL')).toBe('LAR')
  })

  it('sportSegmentForIdentityKeys keeps PGA distinct from NFL default', () => {
    expect(sportSegmentForIdentityKeys('PGA')).toBe('PGA')
    expect(sportSegmentForIdentityKeys('NFL')).toBe('NFL')
    const kPga = buildStrictPlayerKey({
      name: 'Tiger Woods',
      position: 'G',
      team: 'FAKE',
      sport: 'PGA',
    })
    const kNfl = buildStrictPlayerKey({
      name: 'Tiger Woods',
      position: 'G',
      team: 'FAKE',
      sport: 'NFL',
    })
    expect(kPga).not.toBe(kNfl)
  })

  it('same player name across NBA vs MLB never shares strict key (sport suffix)', () => {
    const nba = buildStrictPlayerKey({
      name: 'Kevin Someone',
      position: 'SF',
      team: 'PHX',
      sport: 'NBA',
    })
    const mlb = buildStrictPlayerKey({
      name: 'Kevin Someone',
      position: 'OF',
      team: 'ARI',
      sport: 'MLB',
    })
    expect(nba).not.toBe(mlb)
  })
})
