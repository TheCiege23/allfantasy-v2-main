import { describe, expect, it } from 'vitest'
import { starterGameStates, weekFinished } from '@/lib/core-app/matchupGameState'

const now = new Date('2026-09-27T19:00:00Z')
const players = new Map([['a', { team: 'BUF' }], ['b', { team: 'NYJ' }], ['c', { team: 'DAL' }]])
const game = (status: string, fetchedAt = now) => ({ homeTeam: 'BUF', awayTeam: 'NYJ', status, fetchedAt, startTime: new Date('2026-09-27T17:00:00Z') })

describe('matchup starter game states', () => {
  it('does not infer a final from a past kickoff or a stale live row', () => {
    expect(starterGameStates(players, [game('scheduled')], now).get('a')).toBe('unknown')
    expect(starterGameStates(players, [game('live', new Date('2026-09-27T17:00:00Z'))], now).get('a')).toBe('unknown')
  })
  it('separates playing, completed and missing games', () => {
    expect(starterGameStates(players, [game('STATUS_IN_PROGRESS')], now).get('a')).toBe('live')
    const result = starterGameStates(players, [game('STATUS_FINAL', new Date('2026-09-25T00:00:00Z'))], now)
    expect(result.get('a')).toBe('final')
    expect(result.get('c')).toBe('unknown')
  })
  it('uses the latest provider update and only counts future scheduled games as upcoming', () => {
    expect(starterGameStates(players, [game('final', new Date('2026-09-27T18:00:00Z')), game('live')], now).get('a')).toBe('live')
    expect(starterGameStates(players, [{ ...game('scheduled'), startTime: new Date('2026-09-27T20:00:00Z') }], now).get('a')).toBe('upcoming')
  })
  it('accepts an untyped live update only when its kickoff matches a regular-season fixture', () => {
    const fixture = { ...game('scheduled', new Date('2026-09-20T00:00:00Z')), seasonType: 'regular' }
    expect(starterGameStates(players, [fixture, { ...game('live'), seasonType: null }], now).get('a')).toBe('live')
    const preseason = { ...game('final'), startTime: new Date('2026-08-20T00:00:00Z'), seasonType: null }
    expect(starterGameStates(players, [fixture, preseason], now).get('a')).toBe('unknown')
  })
})

describe('weekFinished — is every regular-season game of a week final?', () => {
  const at = (iso: string) => new Date(iso)
  const g = (
    home: string,
    away: string,
    kickoff: string,
    status: string,
    seasonType: string | null,
    fetchedAt = at('2026-09-29T14:00:00Z'),
  ) => ({ homeTeam: home, awayTeam: away, startTime: at(kickoff), status, seasonType, fetchedAt })

  it('true once every regular-season fixture reads final (case-insensitive)', () => {
    expect(
      weekFinished([
        g('Chicago Bears', 'Philadelphia Eagles', '2026-09-29T00:15:00Z', 'final', 'regular'),
        g('BUF', 'MIA', '2026-09-28T17:00:00Z', 'Final', 'regular'),
      ]),
    ).toBe(true)
  })

  it('false while any fixture is still to be played — a past kickoff is not a final', () => {
    expect(
      weekFinished([
        g('BUF', 'MIA', '2026-09-28T17:00:00Z', 'final', 'regular'),
        g('CHI', 'PHI', '2026-09-29T00:15:00Z', 'scheduled', 'regular'),
      ]),
    ).toBe(false)
  })

  it('reads each fixture from its NEWEST row, including an untyped live-score row for the same game', () => {
    expect(
      weekFinished([
        g('CHI', 'PHI', '2026-09-29T00:15:00Z', 'scheduled', 'regular', at('2026-09-28T20:00:00Z')),
        g('Chicago Bears', 'Philadelphia Eagles', '2026-09-29T00:15:00Z', 'final', null, at('2026-09-29T04:00:00Z')),
      ]),
    ).toBe(true)
  })

  it('ignores preseason rows that reuse the week number — measured: espn_live held August "week 3"', () => {
    const regular = g('CHI', 'PHI', '2026-09-29T00:15:00Z', 'final', 'regular')
    // A scheduled preseason row with the same week number does not hold the week open…
    expect(weekFinished([regular, g('NYG', 'NYJ', '2026-08-22T00:00:00Z', 'scheduled', 'pre')])).toBe(true)
    // …an untyped row that matches no regular fixture does not either…
    expect(weekFinished([regular, g('NYG', 'NYJ', '2026-08-22T00:00:00Z', 'scheduled', null)])).toBe(true)
    // …and preseason finals alone never make a regular-season week finished.
    expect(weekFinished([g('NYG', 'NYJ', '2026-08-22T00:00:00Z', 'final', 'pre')])).toBe(false)
  })

  it('false with no regular-season fixture at all — unknown is not finished', () => {
    expect(weekFinished([])).toBe(false)
  })
})
