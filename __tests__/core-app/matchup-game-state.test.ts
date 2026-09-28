import { describe, expect, it } from 'vitest'
import { starterGameStates } from '@/lib/core-app/matchupGameState'

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
