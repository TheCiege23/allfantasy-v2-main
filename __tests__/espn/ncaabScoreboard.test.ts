import { describe, expect, it } from 'vitest'
import { matchCollegeScheduleGames, parseEspnCollegeScoreboard } from '@/lib/espn/espnNcaabScoreboard'
import type { ScheduleGame } from '@/lib/sports-data/riScheduleCache'
const event = (id: string) => ({ id, date: '2026-11-02T00:30:00Z', competitions: [{ status: { type: { state: 'post' } }, competitors: [{ homeAway: 'home', team: { id: '10' } }, { homeAway: 'away', team: { id: '20' } }] }] })
const game = (gameId: string): ScheduleGame => ({ gameId, day: '2026-11-01', startTime: null, status: 'completed', seasonType: 'regular', eventName: null, replacedBy: null, homeTeamId: '1', awayTeamId: '2' })
describe('ESPN college game crosswalk', () => {
  it('uses Eastern game day and matches both provider team IDs', () => {
    const parsed = parseEspnCollegeScoreboard({ events: [event('100')] })
    expect(parsed.games[0]).toMatchObject({ id: '100', day: '2026-11-01', status: 'final' })
    expect([...matchCollegeScheduleGames([game('ri-1')], parsed.games, new Map([['1', '10'], ['2', '20']])).matched]).toEqual([['ri-1', '100']])
  })
  it('refuses doubleheaders, duplicates and incomplete source data', () => {
    const parsed = parseEspnCollegeScoreboard({ events: [event('100'), event('101')] })
    expect(matchCollegeScheduleGames([game('ri-1')], parsed.games, new Map([['1', '10'], ['2', '20']])).unresolved).toEqual(['ri-1'])
    expect(matchCollegeScheduleGames([game('a'), game('b')], [parsed.games[0]], new Map([['1', '10'], ['2', '20']])).unresolved).toEqual(['a', 'b'])
    expect(parseEspnCollegeScoreboard({ events: [event('100'), event('100')] }).rejected).toBe(1)
    expect(parseEspnCollegeScoreboard({}).rejected).toBe(1)
  })
})
