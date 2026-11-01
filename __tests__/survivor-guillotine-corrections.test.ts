import { describe, expect, it } from 'vitest'
import { isAutomaticCeremonyDue, partitionReleasedPlayers, selectActiveFinalScores } from '@/lib/survivor-guillotine/corrections'

describe('Survivor Guilly correction recovery', () => {
  it('restores free players but preserves settled waiver ownership', () => {
    expect(partitionReleasedPlayers(['free', 'claimed', 'free'], new Set(['claimed']))).toEqual({
      restore: ['free'], retainedByClaimants: ['claimed'],
    })
  })

  it('runs only due automatic ceremonies for the active scoring period', () => {
    const input = { mode: 'automatic' as const, ceremonyAt: '2026-11-02T02:00:00Z',
      statePeriod: 4, currentPeriod: 4, now: new Date('2026-11-02T02:05:00Z') }
    expect(isAutomaticCeremonyDue(input)).toBe(true)
    expect(isAutomaticCeremonyDue({ ...input, mode: 'hosted' })).toBe(false)
    expect(isAutomaticCeremonyDue({ ...input, currentPeriod: 5 })).toBe(false)
    expect(isAutomaticCeremonyDue({ ...input, now: new Date('2026-11-02T01:55:00Z') })).toBe(false)
  })

  it('accepts current finalists when a previously chopped roster still has a final row', () => {
    const scores = [{ rosterId: 'chopped', points: 90 }, { rosterId: 'active-1', points: 85 },
      { rosterId: 'active-2', points: 100 }]
    expect(selectActiveFinalScores(scores, ['active-1', 'active-2'])).toEqual(scores.slice(1))
    expect(() => selectActiveFinalScores(scores, ['active-1', 'missing'])).toThrow('Every active roster')
  })
})
