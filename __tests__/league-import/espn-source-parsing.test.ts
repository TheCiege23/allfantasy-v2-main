/**
 * ESPN private-league import — source-input parsing. Pure function, no auth/network involved.
 * Covers the example from the ESPN cookie-auth build brief (leagueId=919055222, seasonId=2026)
 * in each format a user might realistically paste.
 */
import { describe, it, expect } from 'vitest'
import { parseEspnSourceInput } from '@/lib/league-import/espn/EspnLeagueFetchService'

describe('parseEspnSourceInput', () => {
  it('parses a bare league ID, defaulting season to the current year', () => {
    const result = parseEspnSourceInput('919055222')
    expect(result).toEqual({ leagueId: '919055222', season: new Date().getFullYear() })
  })

  it('parses the season-first shorthand (season:leagueId)', () => {
    expect(parseEspnSourceInput('2026:919055222')).toEqual({ leagueId: '919055222', season: 2026 })
  })

  it('parses the league-first shorthand (leagueId@season)', () => {
    expect(parseEspnSourceInput('919055222@2026')).toEqual({ leagueId: '919055222', season: 2026 })
  })

  it('parses a full ESPN league URL', () => {
    const url = 'https://fantasy.espn.com/football/league?leagueId=919055222&seasonId=2026'
    expect(parseEspnSourceInput(url)).toEqual({ leagueId: '919055222', season: 2026 })
  })

  it('parses a bare query string (no https:// prefix)', () => {
    expect(parseEspnSourceInput('leagueId=919055222&seasonId=2026')).toEqual({
      leagueId: '919055222',
      season: 2026,
    })
  })

  it('trims whitespace around the input', () => {
    expect(parseEspnSourceInput('  919055222  ')).toEqual({
      leagueId: '919055222',
      season: new Date().getFullYear(),
    })
  })

  it('throws a clear error for empty input', () => {
    expect(() => parseEspnSourceInput('')).toThrow('ESPN league ID is required.')
    expect(() => parseEspnSourceInput('   ')).toThrow('ESPN league ID is required.')
  })

  it('throws a clear error when no league ID can be resolved', () => {
    expect(() => parseEspnSourceInput('not a league id')).toThrow(
      'Enter an ESPN league ID, a full ESPN league URL, or a season-prefixed value like 2025:12345678.',
    )
  })
})
