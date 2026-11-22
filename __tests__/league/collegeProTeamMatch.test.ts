import { describe, expect, it } from 'vitest'
import { fantraxPeriodForWindow, readTeamMap, suggestTeamMatches, teamKey } from '@/lib/league/collegePro/teamMatch'

// The real Peach Bowl (Sleeper) and Cream Bowl (Fantrax) team lists, 2026-11-21.
const SLEEPER = [
  ['8', '(F) SF TEP', 'TheCiege24'], ['5', 'Connor0488', 'Connor0488'], ['6', 'Georgia Bulldogs', 'unclerayrayy'],
  ['11', 'GrindingFFB', 'GrindingFFB'], ['12', 'It hurts to puka🤮', 'yourdyinggranpa'], ['1', 'JMasc', 'JMasc'],
  ['2', 'KingGustov', 'KingGustov'], ['3', 'Lou Holtz & Company', 'loganhall17'], ['10', 'Scoresscotty', 'Scoresscotty'],
  ['9', 'TQ Trojans', 'TQ34'], ['4', 'jws452', 'jws452'], ['7', 'rfasti', 'rfasti'],
].map(([rosterId, teamName, ownerName]) => ({ rosterId: rosterId!, teamName: teamName!, ownerName: ownerName! }))
const FANTRAX = [
  ['scot', 'Scorescotty'], ['gran', 'Yourdyinggrandpa'], ['conn', 'Connor0488'], ['uga', 'Georgia Bulldogs'], ['jws', 'Jws452'],
  ['ciege', 'Ciege82'], ['logan', 'loganhall'], ['jmasc', 'Team JMasc'], ['king', 'king gustov'], ['tq', 'TQ Trojans'],
  ['grind', 'Grindingffb'], ['rf', 'rfasti'],
].map(([teamId, name]) => ({ teamId: teamId!, name: name! }))

describe('suggestTeamMatches on the real league pair', () => {
  const s = suggestTeamMatches(SLEEPER, FANTRAX, { '8': 'ciege' })

  it('matches every team, one to one', () => {
    expect(Object.keys(s).length).toBe(12)
    expect(new Set(Object.values(s)).size).toBe(12)
  })

  it('handles the spellings the two platforms disagree on', () => {
    expect(s['10']).toBe('scot') // Scoresscotty / Scorescotty
    expect(s['12']).toBe('gran') // yourdyinggranpa / Yourdyinggrandpa
    expect(s['3']).toBe('logan') // loganhall17 / loganhall
    expect(s['2']).toBe('king') // KingGustov / king gustov
    expect(s['1']).toBe('jmasc') // JMasc / Team JMasc
  })

  it('a pair the franchise link already knows is fixed, not guessed', () => {
    expect(s['8']).toBe('ciege') // TheCiege24 / Ciege82 share no name
  })

  it('leaves a team unmatched rather than guess', () => {
    const r = suggestTeamMatches([{ rosterId: 'x', teamName: 'Completely Different', ownerName: 'zzz' }], FANTRAX)
    expect(r).toEqual({})
  })
})

describe('teamKey / readTeamMap / fantraxPeriodForWindow', () => {
  it('normalizes names', () => {
    expect(teamKey('Team JMasc')).toBe('jmasc')
    expect(teamKey('loganhall17')).toBe('loganhall')
  })

  it('drops junk and duplicate Fantrax teams from a saved map', () => {
    expect(readTeamMap({ '1': 'a', '2': 'a', '3': 5, '4': '' })).toEqual({ '1': 'a' })
    expect(readTeamMap(null)).toEqual({})
  })

  it('finds the Fantrax period inside an NFL week window', () => {
    const periods = [
      { number: 11, startDate: '2026-11-10T12:00:00.0-0500', endDate: '2026-11-17T11:59:59.0-0500' },
      { number: 12, startDate: '2026-11-17T12:00:00.0-0500', endDate: '2026-11-24T11:59:59.0-0500' },
    ]
    const nflWeek12 = { start: Date.UTC(2026, 10, 17, 9), end: Date.UTC(2026, 10, 24, 9) }
    expect(fantraxPeriodForWindow(periods, nflWeek12)).toBe(12)
    expect(fantraxPeriodForWindow([], nflWeek12)).toBeNull()
  })
})
