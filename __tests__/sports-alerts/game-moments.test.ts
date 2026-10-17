// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { clockSeconds, detectGameMoments, isPostseasonLabel, momentText, soccerMinute, type MomentRow } from '@/lib/live/gameMoments'

function row(over: Partial<MomentRow>): MomentRow {
  return {
    gameId: '401',
    homeTeam: 'BOS',
    homeTeamFull: 'Boston Celtics',
    awayTeam: 'NY',
    awayTeamFull: 'New York Knicks',
    homeScore: 50,
    awayScore: 48,
    status: 'STATUS_IN_PROGRESS',
    statusDetail: '',
    period: 2,
    clock: '5:00',
    completed: false,
    eventName: 'New York Knicks at Boston Celtics',
    ...over,
  }
}

const kinds = (sport: string, r: MomentRow) => detectGameMoments(sport, r).map((m) => m.kind)

describe('clocks', () => {
  it('reads countdown and soccer clocks', () => {
    expect(clockSeconds('4:32')).toBe(272)
    expect(clockSeconds('0.4')).toBe(0.4)
    expect(clockSeconds('')).toBeNull()
    expect(soccerMinute("78'")).toBe(78)
    expect(soccerMinute("90'+3'")).toBe(93)
  })
})

describe('detectGameMoments', () => {
  it('basketball halftime', () => {
    expect(kinds('NBA', row({ status: 'STATUS_HALFTIME', period: 2, clock: '0.0' }))).toEqual(['halftime'])
  })
  it('NBA close late: 4th quarter, under 5:00, within 5', () => {
    expect(kinds('NBA', row({ period: 4, clock: '2:10', homeScore: 101, awayScore: 99, statusDetail: '2:10 - 4th' }))).toEqual(['close_late'])
    expect(kinds('NBA', row({ period: 4, clock: '2:10', homeScore: 120, awayScore: 99 }))).toEqual([])
    expect(kinds('NBA', row({ period: 3, clock: '2:10', homeScore: 80, awayScore: 79 }))).toEqual([])
  })
  it('overtime replaces close_late', () => {
    expect(kinds('NBA', row({ period: 5, clock: '3:00', homeScore: 110, awayScore: 109 }))).toEqual(['overtime'])
  })
  it('NHL intermissions and a one-goal third', () => {
    expect(kinds('NHL', row({ status: 'STATUS_END_PERIOD', period: 2, clock: '0:00' }))).toEqual(['end_period'])
    expect(kinds('NHL', row({ status: 'STATUS_END_PERIOD', period: 3, clock: '0:00', homeScore: 3, awayScore: 3 }))).toEqual([])
    expect(kinds('NHL', row({ period: 3, clock: '8:00', homeScore: 2, awayScore: 1 }))).toEqual(['close_late'])
    expect(kinds('NHL', row({ period: 3, clock: '15:00', homeScore: 2, awayScore: 1 }))).toEqual([])
  })
  it('MLB seventh inning and a two-run eighth', () => {
    expect(kinds('MLB', row({ period: 7, clock: '', homeScore: 4, awayScore: 1 }))).toEqual(['seventh_inning'])
    expect(kinds('MLB', row({ period: 8, clock: '', homeScore: 4, awayScore: 2 }))).toEqual(['close_late'])
    expect(kinds('MLB', row({ period: 10, clock: '', homeScore: 4, awayScore: 4 }))).toEqual(['overtime'])
  })
  it('soccer late and level', () => {
    expect(kinds('SOCCER', row({ status: 'STATUS_SECOND_HALF', period: 2, clock: "81'", homeScore: 1, awayScore: 1 }))).toEqual(['close_late'])
  })
  it('final only with a score; scheduled games show nothing', () => {
    expect(kinds('NBA', row({ completed: true, status: 'STATUS_FINAL' }))).toEqual(['final'])
    expect(kinds('NBA', row({ status: 'STATUS_SCHEDULED', period: 0, homeScore: null, awayScore: null }))).toEqual([])
  })
  it('marks playoff games from the round label, not the matchup name', () => {
    expect(isPostseasonLabel('ALCS - Game 3')).toBe(true)
    expect(isPostseasonLabel('East 1st Round - Game 2')).toBe(true)
    expect(isPostseasonLabel('New York Knicks at Boston Celtics')).toBe(false)
    expect(detectGameMoments('MLB', row({ period: 7, eventName: 'ALCS - Game 3' }))[0].postseason).toBe(true)
  })
})

describe('momentText', () => {
  it('names the leader, the unit and the round', () => {
    const r = row({ period: 8, clock: '', homeScore: 4, awayScore: 3, statusDetail: 'Top 8th', eventName: 'ALCS - Game 3', homeTeamFull: 'New York Yankees', awayTeamFull: 'Toronto Blue Jays' })
    const [m] = detectGameMoments('MLB', r)
    const t = momentText(m, r)
    expect(t.title).toBe('🔥 Close game: Toronto Blue Jays 3, New York Yankees 4')
    expect(t.body).toContain('1-run game')
    expect(t.body).toContain('ALCS - Game 3')
  })
})
