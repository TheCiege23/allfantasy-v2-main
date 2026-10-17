import { describe, expect, it } from 'vitest'
import { completeConfig } from './helpers/seasonTournamentFixture'
import { compareSeasonScheduleDrift } from '@/lib/tournament/seasonScheduleDrift'
import type { CalendarGame } from '@/lib/tournament/seasonCalendarCoverage'

const original = [{ gameId: 'g1', startsAt: '2026-10-21T00:00:00.000Z', period: 1 }]
const game = (overrides: Partial<CalendarGame> = {}): CalendarGame => ({ gameId: 'g1', startTime: original[0]!.startsAt, seasonType: 'regular', status: 'scheduled', replacedBy: null, ...overrides })
const compare = (games: CalendarGame[], published = original) => compareSeasonScheduleDrift(completeConfig().rules!, published, games)

describe('published season schedule drift', () => {
  it('reports unchanged rows without claiming actual tipoff', () => {
    expect(compare([game()])).toMatchObject({ scheduleMatches: true, requiresReview: false, actualStartVerified: false, changes: [] })
  })
  it('finds moves within and across scoring periods without reassigning the locked period', () => {
    const same = compare([game({ startTime: '2026-10-22T00:00:00Z' })]).changes[0]!
    expect(same).toMatchObject({ kind: 'rescheduled', publishedPeriod: 1, currentScheduledPeriod: 1 })
    const across = compare([game({ startTime: '2026-10-29T00:00:00Z' })]).changes[0]!
    expect(across).toMatchObject({ kind: 'rescheduled', publishedPeriod: 1, currentScheduledPeriod: 2 })
  })
  it('flags postponement even when scheduled time has not changed', () => {
    expect(compare([game({ status: 'postponed' })]).changes[0]).toMatchObject({ kind: 'postponed', publishedPeriod: 1 })
  })
  it('flags replaced, canceled, missing and newly appearing games', () => {
    expect(compare([game({ status: 'replaced', replacedBy: 'g2' }), game({ gameId: 'g2' })]).changes.map(c => c.kind)).toEqual(['replaced', 'new_game'])
    expect(compare([game({ status: 'canceled' })]).changes[0]!.kind).toBe('canceled')
    expect(compare([game({ status: 'cancelled' })]).changes[0]!.kind).toBe('canceled')
    expect(compare([]).changes[0]!.kind).toBe('missing')
    expect(compare([game(), game({ gameId: 'cup-game' })]).changes.find(c => c.gameId === 'cup-game')?.kind).toBe('new_game')
    expect(compare([game(), game({ gameId: 'outside', startTime: '2027-05-01T00:00:00Z' })]).changes).toEqual([])
  })
  it('flags conflicting duplicate provider rows and unknown classification', () => {
    expect(compare([game(), game({ startTime: '2026-10-22T00:00:00Z' })]).changes[0]!.kind).toBe('conflict')
    expect(compare([game({ seasonType: null })]).changes[0]!.kind).toBe('unverified')
    expect(() => compare([game()], [...original, ...original])).toThrow(/duplicate game IDs/)
  })
})
