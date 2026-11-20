/**
 * NBA / NHL / MLB rosters show games this week where football shows BYE (2026-11-19): "3 games" on
 * the right and "Fri vs BOS" under the player, from the schedule we store. Team spellings differ by
 * feed (GSW / GS / Golden State Warriors) and must all meet.
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { proTeamKey, proTeamShortCode } from '@/lib/draft-room/proTeamKey'
import { nextGameShort, summarizeWeekGames, weekGamesLabel } from '@/lib/draft-room/weekGames'
import { ResultsRosterPanel } from '@/components/app/draft-room/ResultsRosterPanel'

afterEach(cleanup)

describe('proTeamKey', () => {
  it('meets every spelling of a team in one key', () => {
    const gsw = proTeamKey('NBA', 'Golden State Warriors')
    expect(gsw).toBe('golden state warriors')
    for (const s of ['GSW', 'GS', 'gsw', ' Golden State Warriors ']) expect(proTeamKey('NBA', s)).toBe(gsw)
    expect(proTeamKey('NBA', 'LAC')).toBe(proTeamKey('NBA', 'Los Angeles Clippers'))
    expect(proTeamKey('NBA', 'LA Clippers')).toBe('los angeles clippers')
    expect(proTeamKey('NHL', 'TBL')).toBe('tampa bay lightning')
    expect(proTeamKey('MLB', 'OAK')).toBe('athletics')
  })

  it('never guesses: an unknown team or a football sport has no key', () => {
    expect(proTeamKey('NBA', 'Seattle SuperSonics')).toBeNull()
    expect(proTeamKey('NFL', 'KC')).toBeNull()
    expect(proTeamKey('NBA', null)).toBeNull()
  })

  it('gives the short code back for an opponent', () => {
    expect(proTeamShortCode('NBA', 'boston celtics')).toBe('BOS')
  })
})

describe('summarizeWeekGames', () => {
  const now = new Date('2026-11-20T12:00:00Z')
  const rows = [
    { homeTeam: 'Boston Celtics', awayTeam: 'Golden State Warriors', startTime: '2026-11-21T00:30:00Z' },
    // The same game from a second feed, spelled differently: counted once.
    { homeTeam: 'BOS', awayTeam: 'GS', startTime: '2026-11-21T00:30:00Z' },
    { homeTeam: 'Golden State Warriors', awayTeam: 'Utah Jazz', startTime: '2026-11-23T03:00:00Z' },
    { homeTeam: 'Golden State Warriors', awayTeam: 'Miami Heat', startTime: '2026-11-29T03:00:00Z' }, // past 7 days
    { homeTeam: 'Golden State Warriors', awayTeam: 'Miami Heat', startTime: '2026-11-19T03:00:00Z' }, // already played
  ]

  it('counts the next seven days, once per game, and finds the next one', () => {
    const out = summarizeWeekGames(rows, 'NBA', now)
    expect(out['golden state warriors']).toEqual({
      games: 2,
      next: { startTime: '2026-11-21T00:30:00.000Z', opponent: 'BOS', home: false },
    })
    expect(out['boston celtics']?.games).toBe(1)
    expect(out['miami heat']).toBeUndefined()
  })

  it('labels plainly', () => {
    const gsw = summarizeWeekGames(rows, 'NBA', now)['golden state warriors']
    expect(weekGamesLabel(gsw)).toBe('2 games')
    expect(weekGamesLabel({ games: 1, next: null })).toBe('1 game')
    expect(weekGamesLabel(undefined)).toBeNull()
    expect(nextGameShort(gsw, 'America/New_York')).toBe('Fri @ BOS')
  })
})

describe('My team with games this week', () => {
  const teams = [{ rosterId: 'r1', displayName: 'Me', isCurrentUser: true }]
  const picks = [{ rosterId: 'r1', playerName: 'Stephen Curry', position: 'PG', team: 'GSW', overall: 3, pickLabel: '1.03' }]
  const weekGames = {
    'golden state warriors': { games: 3, next: { startTime: '2026-11-21T00:30:00Z', opponent: 'BOS', home: true } },
  }

  it('shows "3 games" and the next game for an NBA player, and no BYE', () => {
    render(<ResultsRosterPanel teams={teams} picks={picks} currentUserRosterId="r1" starterSlots={{ PG: 1 }} sport="NBA" weekGames={weekGames} />)
    expect(screen.getByTestId('results-roster-panel-starters-games-0').textContent).toBe('3 games')
    expect(screen.getByTestId('results-roster-panel-starters-next-0').textContent).toMatch(/· \w{3} vs BOS$/)
    expect(screen.queryByTestId('results-roster-panel-starters-bye-0')).toBeNull()
  })

  it('shows nothing when the team has no game this week', () => {
    render(<ResultsRosterPanel teams={teams} picks={picks} currentUserRosterId="r1" starterSlots={{ PG: 1 }} sport="NBA" weekGames={{}} />)
    expect(screen.queryByTestId('results-roster-panel-starters-games-0')).toBeNull()
    expect(screen.queryByTestId('results-roster-panel-starters-next-0')).toBeNull()
  })

  it('football keeps BYE and ignores week games', () => {
    render(<ResultsRosterPanel teams={teams} picks={[{ ...picks[0]!, position: 'QB', team: 'KC', byeWeek: 10 }]} currentUserRosterId="r1" starterSlots={{ QB: 1 }} sport="NFL" weekGames={weekGames} />)
    expect(screen.getByTestId('results-roster-panel-starters-bye-0').textContent).toBe('BYE 10')
    expect(screen.queryByTestId('results-roster-panel-starters-games-0')).toBeNull()
  })
})
