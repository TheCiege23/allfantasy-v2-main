/**
 * Which leagues get the redraft "season race" identity, and with which sport theme.
 * lib/league-media/redraftIdentity.ts — native redraft only, every redraft-engine sport, unknown → none.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  REDRAFT_SPORT_THEMES,
  isNativeRedraftLeague,
  redraftSportTheme,
  resolveRedraftIdentity,
} from '@/lib/league-media/redraftIdentity'
import { isNflRedraftCoreDashboardLeague } from '@/lib/league/is-nfl-redraft-core-dashboard'

const native = (over: Record<string, unknown> = {}) => ({ platform: 'allfantasy', sport: 'NFL', leagueType: 'redraft', ...over })

describe('redraftSportTheme', () => {
  it.each([
    ['NFL', 'nfl'], ['nfl', 'nfl'], ['NBA', 'nba'], ['NHL', 'nhl'], ['MLB', 'mlb'],
    ['NCAAF', 'ncaaf'], ['NCAAFB', 'ncaaf'], ['CFB', 'ncaaf'], ['NCAAB', 'ncaab'], ['NCAABB', 'ncaab'],
    ['SOCCER', 'soccer'], ['EPL', 'soccer'],
  ])('%s → %s', (sport, theme) => {
    expect(redraftSportTheme(sport)).toBe(theme)
  })

  it.each(['GOLF', 'PGA', 'CRICKET', 'NCAA_BASEBALL', '', null, undefined])(
    'an unknown sport (%s) is NOT NFL — it gets no theme even though the sport normalizer falls back to NFL',
    sport => {
      expect(redraftSportTheme(sport as string | null | undefined)).toBeNull()
    },
  )

  it('covers exactly the sports the native redraft engine has an adapter for', () => {
    const adapters = readdirSync(join(process.cwd(), 'lib/redraft/sportAdapters'))
      .filter(f => f.endsWith('.ts') && !['index.ts', 'types.ts'].includes(f))
      .map(f => f.replace(/\.ts$/, ''))
      .sort()
    expect([...REDRAFT_SPORT_THEMES].sort()).toEqual(adapters)
  })
})

describe('isNativeRedraftLeague / resolveRedraftIdentity', () => {
  it.each(REDRAFT_SPORT_THEMES.map(theme => [theme]))('a native %s redraft league gets its sport theme', theme => {
    const sport = theme.toUpperCase()
    expect(resolveRedraftIdentity(native({ sport }))?.sport).toBe(theme)
  })

  it.each(['allfantasy', 'af', 'manual', 'native', undefined])('native platform %s counts', platform => {
    expect(isNativeRedraftLeague(native({ platform }))).toBe(true)
  })

  it.each(['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker'])('an imported %s league is excluded', platform => {
    expect(resolveRedraftIdentity(native({ platform }))).toBeNull()
  })

  it.each([
    ['dynasty flag', { isDynasty: true }],
    ['best ball flag', { bestBallMode: true }],
    ['guillotine flag', { guillotineMode: true }],
    ['keeper phase', { keeperPhaseActive: true }],
    ['dynasty type', { leagueType: 'dynasty' }],
    ['keeper type', { leagueType: 'keeper' }],
    ['best ball type', { leagueType: 'best_ball' }],
    ['guillotine type', { leagueType: 'guillotine' }],
    ['survivor type', { leagueType: 'survivor' }],
    ['devy type', { leagueType: 'devy' }],
    ['c2c type', { leagueType: 'c2c' }],
    ['zombie type', { leagueType: 'zombie' }],
    ['salary cap type', { leagueType: 'salary_cap' }],
    ['tournament type', { leagueType: 'tournament' }],
    ['big brother type', { leagueType: 'big_brother' }],
    ['no leagueType at all', { leagueType: null }],
    ['guillotine variant on a redraft type', { leagueVariant: 'guillotine' }],
    ['survivor variant', { leagueVariant: 'survivor' }],
    ['zombie variant', { leagueVariant: 'zombie' }],
    ['big brother variant', { leagueVariant: 'big_brother' }],
    ['best ball variant', { leagueVariant: 'bestball' }],
    ['keeper variant', { leagueVariant: 'keeper' }],
    ['salary cap variant', { leagueVariant: 'salary_cap' }],
    ['tournament feeder variant', { leagueVariant: 'tournament_mode' }],
    ['devy variant', { leagueVariant: 'devy_dynasty' }],
    ['c2c variant', { leagueVariant: 'merged_devy_c2c' }],
    ['dynasty variant', { leagueVariant: 'dynasty' }],
  ])('not redraft: %s', (_name, over) => {
    expect(resolveRedraftIdentity(native(over))).toBeNull()
  })

  it.each(['superflex', 'te_premium', 'redraft', ''])('a redraft modifier variant (%s) stays redraft', leagueVariant => {
    expect(resolveRedraftIdentity(native({ leagueVariant }))?.sport).toBe('nfl')
  })

  it('a native redraft league in an unknown sport keeps the default look', () => {
    expect(isNativeRedraftLeague(native({ sport: 'GOLF' }))).toBe(true)
    expect(resolveRedraftIdentity(native({ sport: 'GOLF' }))).toBeNull()
  })

  it('splitting the format rule out did not change the NFL redraft shell gate', () => {
    expect(isNflRedraftCoreDashboardLeague({ sport: 'NFL', leagueType: 'redraft' })).toBe(true)
    expect(isNflRedraftCoreDashboardLeague({ sport: 'NCAAF', leagueType: 'redraft' })).toBe(true)
    expect(isNflRedraftCoreDashboardLeague({ sport: 'NBA', leagueType: 'redraft' })).toBe(false)
    expect(isNflRedraftCoreDashboardLeague({ sport: 'NFL', leagueType: 'redraft', isDynasty: true })).toBe(false)
    expect(isNflRedraftCoreDashboardLeague({ sport: 'NFL', leagueType: 'redraft', leagueVariant: 'survivor' })).toBe(false)
  })
})
