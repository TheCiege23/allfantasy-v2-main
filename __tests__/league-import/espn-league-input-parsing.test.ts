/**
 * ESPN league ID / URL parsing for the guided import's first step. Pure — no network, no auth.
 * The existing `parseEspnSourceInput` contract is pinned in espn-source-parsing.test.ts; this file
 * covers what the guided flow added on top: `seasonExplicit`, more URL shapes, a wrong-sport link,
 * and the season fallback order for a bare id.
 */
import { describe, it, expect } from 'vitest'
import {
  espnSeasonCandidates,
  parseEspnLeagueInput,
  parseEspnSourceInput,
} from '@/lib/league-import/espn/EspnLeagueFetchService'

const NOV = new Date('2026-11-08T12:00:00Z')
const JAN = new Date('2027-01-10T12:00:00Z')
const JUL = new Date('2027-07-04T12:00:00Z')

describe('parseEspnLeagueInput', () => {
  it('marks a bare id as having a defaulted season', () => {
    expect(parseEspnLeagueInput('919055222', NOV)).toEqual({ leagueId: '919055222', season: 2026, seasonExplicit: false })
  })

  it.each([
    ['https://fantasy.espn.com/football/league?leagueId=919055222&seasonId=2025', 2025],
    ['https://fantasy.espn.com/football/team?leagueId=919055222&teamId=4&seasonId=2024', 2024],
    ['https://fantasy.espn.com/football/league/standings?leagueId=919055222&seasonId=2025', 2025],
    ['fantasy.espn.com/football/league?leagueId=919055222&seasonId=2025', 2025],
    ['www.fantasy.espn.com/football/league?leagueId=919055222&seasonId=2025', 2025],
    ['2025:919055222', 2025],
    ['919055222@2025', 2025],
  ])('extracts id and explicit season from %s', (input, season) => {
    expect(parseEspnLeagueInput(input, NOV)).toEqual({ leagueId: '919055222', season, seasonExplicit: true })
  })

  it('treats a URL without seasonId as a defaulted season', () => {
    expect(parseEspnLeagueInput('https://fantasy.espn.com/football/league?leagueId=919055222', NOV)).toEqual({
      leagueId: '919055222',
      season: 2026,
      seasonExplicit: false,
    })
  })

  it('names the sport when the link is a basketball or hockey league', () => {
    expect(() => parseEspnLeagueInput('https://fantasy.espn.com/basketball/league?leagueId=123')).toThrow(/basketball league/)
    expect(() => parseEspnLeagueInput('https://fantasy.espn.com/hockey/league?leagueId=123')).toThrow(/hockey league/)
  })

  it('rejects text with no league id, and absurdly long numbers', () => {
    expect(() => parseEspnLeagueInput('my league')).toThrow(/ESPN league ID/)
    expect(() => parseEspnLeagueInput('1234567890123456789')).toThrow(/too long/)
  })

  it('keeps the legacy two-field shape for parseEspnSourceInput', () => {
    expect(parseEspnSourceInput('2025:919055222')).toEqual({ leagueId: '919055222', season: 2025 })
  })
})

describe('espnSeasonCandidates', () => {
  it('never second-guesses an explicit season', () => {
    expect(espnSeasonCandidates({ leagueId: '1', season: 2023, seasonExplicit: true }, JAN)).toEqual([2023])
  })

  it('tries last season first in January (the season that just ended)', () => {
    expect(espnSeasonCandidates({ leagueId: '1', season: 2027, seasonExplicit: false }, JAN)).toEqual([2026, 2027])
  })

  it('tries this year first otherwise, then last year (a league not renewed yet)', () => {
    expect(espnSeasonCandidates({ leagueId: '1', season: 2027, seasonExplicit: false }, JUL)).toEqual([2027, 2026])
    expect(espnSeasonCandidates({ leagueId: '1', season: 2026, seasonExplicit: false }, NOV)).toEqual([2026, 2025])
  })
})
