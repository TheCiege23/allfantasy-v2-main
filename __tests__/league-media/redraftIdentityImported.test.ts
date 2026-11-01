/**
 * Imported leagues get the redraft identity only when their STORED data positively says redraft
 * (lib/league-media/redraftIdentity.ts `isImportedRedraftLeague`, batch B-ID). Unknown → no theme.
 */
import { describe, expect, it } from 'vitest'
import { isImportedRedraftLeague, isNativeRedraftLeague, resolveRedraftIdentity } from '@/lib/league-media/redraftIdentity'

const sleeper = (settings: Record<string, unknown> = { sleeper_league_type: 0 }, over: Record<string, unknown> = {}) => ({
  platform: 'sleeper',
  sport: 'NFL',
  leagueType: 'redraft',
  isDynasty: false,
  settings,
  ...over,
})
const espn = (settings: Record<string, unknown> = { espn_keeper_count: 0 }, over: Record<string, unknown> = {}) => ({
  platform: 'espn',
  sport: 'NFL',
  leagueType: 'redraft',
  isDynasty: false,
  settings,
  ...over,
})
const confirmed = (type: string) => ({ leagueTypeConfirmation: { type } })

describe('Sleeper — settings.type stored raw as sleeper_league_type', () => {
  it('type 0 is redraft, for every themed sport Sleeper imports', () => {
    for (const [sport, theme] of [['NFL', 'nfl'], ['NBA', 'nba'], ['NHL', 'nhl'], ['MLB', 'mlb'], ['NCAAF', 'ncaaf'], ['NCAAB', 'ncaab'], ['SOCCER', 'soccer']]) {
      expect(resolveRedraftIdentity(sleeper(undefined, { sport }))?.sport).toBe(theme)
    }
  })
  it('type 1 (keeper) and type 2 (dynasty) are not', () => {
    expect(isImportedRedraftLeague(sleeper({ sleeper_league_type: 1, is_keeper: true }))).toBe(false)
    expect(isImportedRedraftLeague(sleeper({ sleeper_league_type: 2 }, { isDynasty: true }))).toBe(false)
  })
  it('a type that was never stored is UNKNOWN, not redraft — even with leagueType redraft and every flag false', () => {
    expect(isImportedRedraftLeague(sleeper({ is_keeper: false, isDynasty: false }))).toBe(false)
    expect(isImportedRedraftLeague(sleeper({}))).toBe(false)
    expect(isImportedRedraftLeague(sleeper(null as never))).toBe(false)
    expect(isImportedRedraftLeague(sleeper(undefined, { settings: undefined }))).toBe(false)
  })
  it('the string "0" is not the number 0 (the mapper stores an integer)', () => {
    expect(isImportedRedraftLeague(sleeper({ sleeper_league_type: '0' }))).toBe(false)
  })
  it('best ball vetoes, from the stored flag or the column', () => {
    expect(isImportedRedraftLeague(sleeper({ sleeper_league_type: 0, best_ball: true }))).toBe(false)
    expect(isImportedRedraftLeague(sleeper(undefined, { bestBallMode: true }))).toBe(false)
  })
  it('a name-signal classification in the column vetoes (guillotine, survivor…)', () => {
    for (const leagueType of ['guillotine', 'survivor', 'best_ball', 'dynasty', 'keeper', null]) {
      expect(isImportedRedraftLeague(sleeper(undefined, { leagueType }))).toBe(false)
    }
  })
  it('guillotine flag, specialty variant and the importer\'s own isDynasty veto', () => {
    expect(isImportedRedraftLeague(sleeper(undefined, { guillotineMode: true }))).toBe(false)
    expect(isImportedRedraftLeague(sleeper(undefined, { leagueVariant: 'devy_dynasty' }))).toBe(false)
    expect(isImportedRedraftLeague(sleeper(undefined, { leagueVariant: 'survivor' }))).toBe(false)
    expect(isImportedRedraftLeague(sleeper({ sleeper_league_type: 0, isDynasty: true }))).toBe(false)
  })
  it('an unthemed sport gets no identity even when redraft', () => {
    expect(isImportedRedraftLeague(sleeper(undefined, { sport: 'GOLF' }))).toBe(true)
    expect(resolveRedraftIdentity(sleeper(undefined, { sport: 'GOLF' }))).toBeNull()
  })
})

describe('ESPN — keeper count stored raw as espn_keeper_count', () => {
  it('zero keepers is redraft', () => {
    expect(resolveRedraftIdentity(espn())?.sport).toBe('nfl')
    expect(resolveRedraftIdentity(espn(undefined, { sport: 'MLB' }))?.sport).toBe('mlb')
  })
  it('a keeper count is not; no count is unknown', () => {
    expect(isImportedRedraftLeague(espn({ espn_keeper_count: 3 }, { isDynasty: true }))).toBe(false)
    expect(isImportedRedraftLeague(espn({ espn_keeper_count: 3 }))).toBe(false)
    expect(isImportedRedraftLeague(espn({}))).toBe(false)
  })
})

describe('Yahoo, MFL, Fantrax, Fleaflicker — no positive signal is stored', () => {
  it.each(['yahoo', 'mfl', 'fantrax', 'fleaflicker'])('%s: a redraft-looking row is unknown', platform => {
    // Fleaflicker stores `league_type: 'redraft'` even when maxKeepers was absent — not evidence.
    const row = { platform, sport: 'NFL', leagueType: 'redraft', isDynasty: false, settings: { league_type: 'redraft', sleeper_league_type: 0, espn_keeper_count: 0 } }
    expect(isImportedRedraftLeague(row)).toBe(false)
    expect(resolveRedraftIdentity(row)).toBeNull()
  })
})

describe('a person\'s confirmation outranks every import', () => {
  it.each(['sleeper', 'espn', 'yahoo', 'mfl', 'fantrax', 'fleaflicker'])('%s: confirmed redraft themes', platform => {
    expect(resolveRedraftIdentity({ platform, sport: 'NBA', leagueType: 'redraft', settings: confirmed('redraft') })?.sport).toBe('nba')
  })
  it('confirmed redraft wins over a stale leagueType column', () => {
    expect(isImportedRedraftLeague({ platform: 'yahoo', sport: 'NFL', leagueType: 'dynasty', settings: confirmed('redraft') })).toBe(true)
  })
  it.each(['dynasty', 'keeper', 'best_ball', 'guillotine', 'survivor', 'zombie'])('confirmed %s vetoes, even over sleeper_league_type 0', type => {
    expect(isImportedRedraftLeague(sleeper({ sleeper_league_type: 0, ...confirmed(type) }))).toBe(false)
  })
  it('a confirmation that is not a known concept is ignored (falls back to the platform rule)', () => {
    expect(isImportedRedraftLeague({ platform: 'yahoo', sport: 'NFL', leagueType: 'redraft', settings: confirmed('nonsense') })).toBe(false)
    expect(isImportedRedraftLeague(sleeper({ sleeper_league_type: 0, ...confirmed('nonsense') }))).toBe(true)
  })
})

describe('the native rule is unchanged', () => {
  it('a native redraft league themes with or without settings; the import rule never applies to it', () => {
    const native = { platform: 'allfantasy', sport: 'NFL', leagueType: 'redraft' }
    expect(isNativeRedraftLeague(native)).toBe(true)
    expect(isImportedRedraftLeague(native)).toBe(false)
    expect(resolveRedraftIdentity(native)?.sport).toBe('nfl')
    expect(resolveRedraftIdentity({ ...native, settings: confirmed('dynasty') })?.sport).toBe('nfl')
  })
  it('an unknown platform is neither native-by-default nor an import', () => {
    expect(isImportedRedraftLeague({ platform: 'cbs', sport: 'NFL', leagueType: 'redraft', settings: confirmed('redraft') })).toBe(false)
  })
})
