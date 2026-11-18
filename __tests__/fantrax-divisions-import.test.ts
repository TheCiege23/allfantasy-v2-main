import { describe, expect, it } from 'vitest'

import { parseStandingsDivisions, readFantraxDivisions, STANDINGS_DIVISIONS_KEY } from '@/lib/league-import/standingsDivisions'

describe('Fantrax divisions', () => {
  it('keeps every division of a big league, uneven sizes included', () => {
    // 34 teams in 8 divisions: two of five, six of four.
    const sizes = [5, 5, 4, 4, 4, 4, 4, 4]
    const byTeam: Record<string, string> = {}
    let team = 0
    sizes.forEach((size, d) => { for (let i = 0; i < size; i += 1) byTeam[String(1000 + team++)] = `Division ${d + 1} ` })
    const divisions = readFantraxDivisions(byTeam)
    expect(divisions?.source).toBe('fantrax')
    expect(Object.keys(divisions!.names)).toHaveLength(8)
    expect(Object.keys(divisions!.teams)).toHaveLength(34)
    // Names are trimmed (Fantrax sends "NFC East ").
    expect(divisions!.teams['1000']).toBe('Division 1')
    // It survives the settings round trip.
    expect(parseStandingsDivisions({ [STANDINGS_DIVISIONS_KEY]: divisions })).toEqual(divisions)
  })

  it('reads a league with no divisions, or only one, as having none', () => {
    expect(readFantraxDivisions({})).toBeNull()
    expect(readFantraxDivisions(null)).toBeNull()
    expect(readFantraxDivisions({ a: 'Only', b: 'Only' })).toBeNull()
  })
})

import { FantraxLeagueMapper } from '@/lib/league-import/adapters/fantrax/FantraxLeagueMapper'
import type { FantraxImportPayload } from '@/lib/league-import/adapters/fantrax/types'

describe('Fantrax games per week', () => {
  const payload = (schedule: FantraxImportPayload['schedule']) => ({
    sourceInput: 'x',
    league: { leagueId: 'L1', name: 'League', sport: 'NBA', season: 2026, size: 4, isDevy: false },
    settings: null, teams: [], schedule, transactions: [], draftPicks: [], playerMap: {}, previousSeasons: [],
  } as unknown as FantraxImportPayload)
  const game = (teamId1: string, teamId2: string, isPlayoff = false) => ({ teamId1, teamId2, isPlayoff })

  it('records how many games each team plays in a week, from the schedule itself', () => {
    const league = FantraxLeagueMapper.map(payload([
      { week: 1, season: 2026, matchups: [game('a', 'b'), game('a', 'c'), game('a', 'd'), game('b', 'c'), game('b', 'd'), game('c', 'd')] },
    ])) as Record<string, unknown>
    expect(league.games_per_week).toBe(3)
  })

  it('leaves an ordinary one-game league alone, and ignores playoff weeks', () => {
    const league = FantraxLeagueMapper.map(payload([
      { week: 1, season: 2026, matchups: [game('a', 'b'), game('c', 'd')] },
      { week: 15, season: 2026, matchups: [game('a', 'b', true), game('a', 'c', true)] },
    ])) as Record<string, unknown>
    expect('games_per_week' in league).toBe(false)
  })
})
