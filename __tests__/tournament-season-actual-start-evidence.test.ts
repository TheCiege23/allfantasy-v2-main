import { describe, expect, it } from 'vitest'
import { assessSeasonActualStart, classifyRiLiveStartState, type GameStartObservation } from '@/lib/tournament/seasonActualStartEvidence'
const digest = 'a'.repeat(64)
const observation = (state: GameStartObservation['state'], observedAt: string, scheduledAt = '2026-10-21T00:00:00Z'): GameStartObservation => ({ providerGameId: 'g1', sport: 'NBA', state, observedAt, scheduledAt, rawDigest: digest })
const pre = observation('not_started', '2026-10-20T23:59:00Z')
const live = observation('in_progress', '2026-10-21T00:03:00Z')
const options = { providerGameId: 'g1', sport: 'NBA' as const, periodStartsAt: '2026-10-20T00:00:00Z', periodEndsAt: '2026-10-27T00:00:00Z', lineupLockedAt: '2026-10-20T23:58:00Z' }
describe('server-observed actual-start window', () => {
  it('classifies measured live status vocabulary without treating final as a kickoff timestamp', () => {
    expect(classifyRiLiveStartState('inprogress')).toBe('in_progress')
    expect(classifyRiLiveStartState('completed')).toBe('final')
    expect(classifyRiLiveStartState('postponed')).toBe('postponed')
    expect(classifyRiLiveStartState('unexpected')).toBe('unknown')
  })
  it('bounds a start only between fresh pregame and in-progress observations', () => {
    expect(assessSeasonActualStart([live, pre], options)).toEqual({ verifiedWindow: true, startAfter: pre.observedAt, startedBy: live.observedAt, needsCorrectionReview: false, reason: null })
    expect(assessSeasonActualStart([observation('final', live.observedAt), pre], options).verifiedWindow).toBe(false)
    expect(assessSeasonActualStart([live], options).verifiedWindow).toBe(false)
  })
  it('fails closed for wide gaps, period boundaries, and late lineup locks', () => {
    expect(assessSeasonActualStart([observation('not_started', '2026-10-20T23:30:00Z'), live], options).reason).toMatch(/too wide/)
    expect(assessSeasonActualStart([pre, live], { ...options, periodStartsAt: '2026-10-21T00:00:00Z' }).reason).toMatch(/period boundary/)
    expect(assessSeasonActualStart([pre, live], { ...options, lineupLockedAt: '2026-10-21T00:00:00Z' }).reason).toMatch(/lineup lock/)
  })
  it('invalidates prior evidence on a later postponement or changed schedule', () => {
    expect(assessSeasonActualStart([pre, live, observation('postponed', '2026-10-21T00:05:00Z')], options).reason).toMatch(/contradicts/)
    expect(assessSeasonActualStart([pre, observation('in_progress', live.observedAt, '2026-10-22T00:00:00Z')], options).reason).toMatch(/scheduled time changed/)
    expect(assessSeasonActualStart([pre, live, observation('final', '2026-10-21T00:06:00Z', '2026-10-22T00:00:00Z')], options).reason).toMatch(/scheduled time changed/)
    expect(assessSeasonActualStart([pre, { ...live, providerGameId: 'other' }], options).reason).toMatch(/identity/)
  })
})
