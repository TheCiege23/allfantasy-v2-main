import { describe, expect, it } from 'vitest'
import { deadlineForPhase, resolveBigBrotherDeadlines } from '@/lib/big-brother/schedule'
const cycle = { createdAt: '2026-09-27T18:00:00Z' }
describe('cycle anchored house deadlines', () => {
  it('uses settings weekday convention, wraps the next milestone forward and keeps late sweeps overdue', () => {
    const config = { nominationDeadlineDayOfWeek: 7, nominationDeadlineTimeUtc: '20:00', vetoDrawDayOfWeek: 1, vetoDrawTimeUtc: '10:00' }
    const dates = resolveBigBrotherDeadlines(config, cycle)
    expect(dates.nomination?.toISOString()).toBe('2026-09-27T20:00:00.000Z')
    expect(dates.veto_draw?.toISOString()).toBe('2026-09-28T10:00:00.000Z')
    expect(deadlineForPhase(config, cycle, 'NOMINATION_OPEN')).toEqual(dates.nomination)
  })
  it.each([0, 8, -1, 1.5])('leaves invalid/unset weekday %s unscheduled', day => {
    expect(resolveBigBrotherDeadlines({ hohChallengeDayOfWeek: day, hohChallengeTimeUtc: '12:00' }, cycle).hoh).toBeNull()
  })
  it.each(['24:00', '9:00', '10:60', ''])('leaves invalid UTC time %s unscheduled', time => {
    expect(resolveBigBrotherDeadlines({ hohChallengeDayOfWeek: 1, hohChallengeTimeUtc: time }, cycle).hoh).toBeNull()
  })
  it('uses extended close time without moving it a week because voting started late', () => {
    const config = { evictionVoteOpenDayOfWeek: 7, evictionVoteOpenTimeUtc: '20:00', evictionVoteCloseDayOfWeek: 7, evictionVoteCloseTimeUtc: '22:00' }
    expect(resolveBigBrotherDeadlines(config, { ...cycle, voteOpenedAt: '2026-09-28T00:00:00Z' }).eviction?.toISOString()).toBe('2026-09-27T22:00:00.000Z')
    expect(resolveBigBrotherDeadlines(config, { ...cycle, voteDeadlineAt: '2026-09-28T12:00:00Z' }).eviction?.toISOString()).toBe('2026-09-28T12:00:00.000Z')
  })
  it('rejects an invalid cycle anchor and does not schedule intermediate states', () => {
    expect(resolveBigBrotherDeadlines({ hohChallengeDayOfWeek: 1, hohChallengeTimeUtc: '10:00' }, {createdAt:'invalid'}).hoh).toBeNull()
    expect(deadlineForPhase({}, cycle, 'NOMINATION_LOCKED')).toBeNull()
  })
})
