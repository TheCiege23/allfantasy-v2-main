import { describe, expect, it } from 'vitest'

import { kickoffClock, lockState } from '@/lib/core-app/lineupLock'
import { playerGame } from '@/lib/core-app/playerGame'

/*
 * The lineup lock read from a kickoff, and the game a player plays this week
 * read from the week's fixture rows. Kickoff: Sunday 2026-10-25 1:00pm ET.
 */

const KICK = '2026-10-25T17:00:00.000Z'

describe('lockState', () => {
  it('counts down in minutes inside the hour, hours and minutes inside the day, names the day beyond it', () => {
    expect(lockState(KICK, '2026-10-25T16:18:00.000Z')).toMatchObject({ state: 'soon', minutes: 42, label: 'locks in 42 min' })
    expect(lockState(KICK, '2026-10-25T15:30:00.000Z')).toMatchObject({ state: 'soon', minutes: 90, label: 'locks in 1h 30m' })
    expect(lockState(KICK, '2026-10-25T13:50:00.000Z')).toMatchObject({ state: 'open', minutes: 190, label: 'locks in 3h 10m' })
    expect(lockState(KICK, '2026-10-23T12:00:00.000Z')).toMatchObject({ state: 'open', label: 'locks Sun 1:00p ET' })
  })

  it('reads as locked from kickoff on, naming the kickoff', () => {
    expect(lockState(KICK, '2026-10-25T17:00:00.000Z')).toMatchObject({ state: 'locked', minutes: 0, label: 'locked · kicked off Sun 1:00p ET' })
    expect(lockState(KICK, '2026-10-25T19:45:00.000Z').state).toBe('locked')
  })

  it('pins the clock to Eastern so the server and the browser print the same string', () => {
    expect(kickoffClock(KICK)).toBe('Sun 1:00p ET')
    expect(kickoffClock('2026-10-23T00:15:00.000Z')).toBe('Thu 8:15p ET') // Thursday night, published as the evening before UTC's date
  })
})

describe('playerGame', () => {
  const week = { season: 2026, week: 8, seasonType: 'regular' } as Parameters<typeof playerGame>[2]
  const rows = [
    // The same fixture from two providers: ESPN's display names, TheSportsDB's without a season type.
    { homeTeam: 'Buffalo Bills', awayTeam: 'Miami Dolphins', startTime: new Date(KICK), seasonType: 'regular', venue: null },
    { homeTeam: 'BUF', awayTeam: 'MIA', startTime: new Date(KICK), seasonType: null, venue: null },
    { homeTeam: 'Dallas Cowboys', awayTeam: 'Philadelphia Eagles', startTime: new Date('2026-10-26T00:20:00.000Z'), seasonType: 'regular', venue: null },
  ]

  it('finds the club through either spelling and keeps the row that knows its season type', () => {
    const g = playerGame(rows, 'BUF', week)
    expect(g).toEqual({ available: true, data: { kickoff: KICK, opponent: 'MIA', home: true, week: 8, season: 2026, preseason: false } })
    expect(playerGame(rows, 'PHI', week)).toMatchObject({ available: true, data: { opponent: 'DAL', home: false } })
  })

  it('says why when there is no team, no week, or no fixture — never a guess', () => {
    expect(playerGame(rows, null, week)).toMatchObject({ available: false, reason: /no team on file/ })
    expect(playerGame(rows, 'BUF', null)).toMatchObject({ available: false, reason: /no upcoming week/ })
    expect(playerGame(rows, 'KC', week)).toMatchObject({ available: false, reason: 'no game on the schedule for KC in week 8' })
  })
})
