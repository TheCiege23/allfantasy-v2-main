import { describe, it, expect } from 'vitest'
import { completeConfig } from './helpers/seasonTournamentFixture'
import { assessSeasonCalendar, type CalendarGame } from '@/lib/tournament/seasonCalendarCoverage'

function fixture(count = 1230) {
  const config = completeConfig()
  const games: CalendarGame[] = Array.from({ length: count }, (_, i) => ({
    gameId: 'g-' + i, startTime: new Date(Date.parse(config.rules.calendar.periods[i % 24]!.startsAt) + 3600000).toISOString(),
    seasonType: 'regular', status: 'scheduled', replacedBy: null,
  }))
  return { config, games }
}
describe('provider calendar coverage', () => {
  it('assigns every published regular-season game exactly once', () => {
    const { config, games } = fixture()
    const report = assessSeasonCalendar(config, games)
    expect(report.ready).toBe(true)
    expect(report.assignments).toHaveLength(1230)
    expect(report.periods.reduce((sum, p) => sum + p.games, 0)).toBe(1230)
    expect(report.excludedGames).toEqual([])
    expect(report.pendingGames).toBe(0)
  })
  it('reports the initial 1200-game NBA slate as having pending Cup-dependent games', () => {
    const { config, games } = fixture(1200)
    expect(assessSeasonCalendar(config, games)).toMatchObject({ ready: true, pendingGames: 30 })
  })
  it.each([0, 1199, 1231])('blocks implausible or truncated slate size %i', count => {
    const { config, games } = fixture(count)
    expect(assessSeasonCalendar(config, games).ready).toBe(false)
  })
  it('deduplicates identical delivery but refuses conflicting start times', () => {
    const { config, games } = fixture()
    expect(assessSeasonCalendar(config, [...games, games[0]!]).regularGames).toBe(1230)
    expect(assessSeasonCalendar(config, [...games, { ...games[0]!, startTime: games[1]!.startTime }]).ready).toBe(false)
  })
  it('reports gap games explicitly without assigning them to an adjacent period', () => {
    const { config, games } = fixture()
    games[0]!.startTime = config.rules.calendar.periods[0]!.endsAt
    const report = assessSeasonCalendar(config, games)
    expect(report.ready).toBe(true)
    expect(report.excludedGames).toEqual([{ gameId: 'g-0', startsAt: games[0]!.startTime }])
    expect(report.assignments.find(g => g.gameId === 'g-0')?.period).toBeNull()
  })
  it.each(['unknown type', 'missing time', 'out of bounds', 'insufficient game duration', 'empty period'])('blocks %s', kind => {
    const { config, games } = fixture()
    if (kind === 'unknown type') games[0]!.seasonType = null
    if (kind === 'missing time') games[0]!.startTime = null
    if (kind === 'out of bounds') config.rules.calendar.regularSeasonEndsAt = config.rules.calendar.periods[22]!.endsAt
    if (kind === 'insufficient game duration') games[0]!.startTime = new Date(Date.parse(config.rules.calendar.periods[0]!.endsAt) - 3600000).toISOString()
    if (kind === 'empty period') for (let i = 0; i < games.length; i += 24) games[i]!.startTime = config.rules.calendar.periods[1]!.startsAt
    expect(assessSeasonCalendar(config, games).ready).toBe(false)
  })
  it('does not count preseason, playoffs or replaced games as regular-season coverage', () => {
    const { config, games } = fixture()
    const extra: CalendarGame[] = [
      { ...games[0]!, gameId: 'pre', seasonType: 'pre' },
      { ...games[0]!, gameId: 'post', seasonType: 'post' },
      { ...games[0]!, gameId: 'old', replacedBy: 'g-0' },
    ]
    expect(assessSeasonCalendar(config, [...games, ...extra]).regularGames).toBe(1230)
  })
})
