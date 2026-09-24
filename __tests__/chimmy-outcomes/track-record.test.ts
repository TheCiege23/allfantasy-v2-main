import { describe, expect, it } from 'vitest'

import { buildAdviceLearningSnapshot, type AdviceOutcome } from '@/lib/chimmy-outcomes/learningSnapshot'
import {
  chimmyTrackRecordFor,
  describeTrackRecord,
  MIN_DECIDED_FOR_OVERALL_RATE,
  MIN_DECIDED_FOR_USER_RATE,
  readTrackRecordLine,
  renderTrackRecordPromptLine,
} from '@/lib/chimmy-outcomes/trackRecord'

/**
 * Chimmy's track record: every graded start/sit call, for the user and for everyone, with a rate
 * only once the sample means something.
 */

const NOW = new Date('2026-09-24T12:00:00Z')

const call = (userId: string, n: number, result: 'right' | 'wrong' | 'same', confidencePct: number | null = null): AdviceOutcome => ({
  userId,
  key: `${userId}:${result}:${n}`,
  adviceType: 'start_sit',
  confidencePct,
  givenAt: new Date(NOW.getTime() - n * 86_400_000),
  call: result,
  followed: 'unclear',
})
const many = (userId: string, result: 'right' | 'wrong' | 'same', count: number, from = 0) =>
  Array.from({ length: count }, (_, i) => call(userId, from + i, result))

const snap = (outcomes: AdviceOutcome[]) => buildAdviceLearningSnapshot(outcomes, { now: NOW, complete: true, users: 3 })

describe('the snapshot keeps score', () => {
  it('counts every graded start/sit call — with or without a confidence — per user and overall', () => {
    const s = snap([...many('u1', 'right', 3), ...many('u1', 'wrong', 1, 10), call('u1', 20, 'same', 70), ...many('u2', 'right', 2, 30)])
    expect(s.record).toEqual({ start_sit: { right: 5, wrong: 1, same: 1 } })
    expect(s.userRecords).toEqual({ u1: [3, 1, 1], u2: [2, 0, 0] })
    /* Calibration still counts only calls that carried a confidence — the record is not calibration. */
    expect(s.totals.calls).toBe(0)
  })

  it('never counts an add toward the record', () => {
    const add: AdviceOutcome = { userId: 'u1', key: 'a', adviceType: 'add', confidencePct: 60, givenAt: NOW, followed: 'yes' }
    expect(snap([add]).record).toEqual({ start_sit: { right: 0, wrong: 0, same: 0 } })
  })
})

describe('chimmyTrackRecordFor', () => {
  it('shows a user their record, with a rate once they have enough decided calls', () => {
    const s = snap([...many('u1', 'right', 4), ...many('u1', 'wrong', 1, 10)])
    expect(MIN_DECIDED_FOR_USER_RATE).toBe(5)
    expect(chimmyTrackRecordFor(s, 'u1')?.you).toEqual({ right: 4, wrong: 1, same: 0, ratePct: 80 })
  })

  /* 2–0 is not "100% right". */
  it('gives counts but no rate below the minimum', () => {
    const s = snap([...many('u1', 'right', 2)])
    expect(chimmyTrackRecordFor(s, 'u1')?.you).toEqual({ right: 2, wrong: 0, same: 0, ratePct: null })
  })

  it('keeps "too close to call" out of the rate', () => {
    const s = snap([...many('u1', 'right', 3), ...many('u1', 'wrong', 2, 10), ...many('u1', 'same', 9, 20)])
    expect(chimmyTrackRecordFor(s, 'u1')?.you).toEqual({ right: 3, wrong: 2, same: 9, ratePct: 60 })
  })

  it('holds the platform-wide rate back until enough calls are graded across everyone', () => {
    expect(MIN_DECIDED_FOR_OVERALL_RATE).toBe(30)
    const under = snap([...many('u1', 'right', 20), ...many('u2', 'wrong', 9, 40)])
    expect(chimmyTrackRecordFor(under, null)?.everyone?.ratePct).toBeNull()
    const over = snap([...many('u1', 'right', 20), ...many('u2', 'wrong', 10, 40)])
    expect(chimmyTrackRecordFor(over, null)?.everyone).toEqual({ right: 20, wrong: 10, same: 0, ratePct: 67 })
  })

  it('is null with nothing graded, and for a snapshot written before the record existed', () => {
    expect(chimmyTrackRecordFor(snap([]), 'u1')).toBeNull()
    const old = snap([...many('u1', 'right', 5)])
    delete old.record
    delete old.userRecords
    expect(chimmyTrackRecordFor(old, 'u1')).toBeNull()
    expect(chimmyTrackRecordFor(null, 'u1')).toBeNull()
  })

  it('never shows one user another user\'s record', () => {
    const s = snap([...many('u2', 'right', 8)])
    expect(chimmyTrackRecordFor(s, 'u1')?.you).toBeNull()
  })
})

describe('the words', () => {
  it('reads as counts, then the rate only when earned, then the close ones', () => {
    expect(describeTrackRecord({ right: 12, wrong: 5, same: 2, ratePct: 71 })).toBe('12 right, 5 wrong (71%) · 2 too close to call')
    expect(describeTrackRecord({ right: 2, wrong: 0, same: 0, ratePct: null })).toBe('2 right, 0 wrong')
  })

  it('tells the model its real numbers and forbids any other record', () => {
    const s = snap([...many('u1', 'right', 12), ...many('u1', 'wrong', 5, 20), ...many('u2', 'right', 20, 40)])
    const text = renderTrackRecordPromptLine(chimmyTrackRecordFor(s, 'u1'))
    expect(text).toContain('- With this user: 12 right, 5 wrong (71%).')
    expect(text).toContain('- Across everyone: 86% right over 37 decided calls.')
    expect(text).toContain('Never state or imply any other record, hit rate or win percentage.')
  })

  /* With nothing to quote, the model is told so — otherwise it invents a hit rate. */
  it('says there is no record rather than leaving the model to invent one', () => {
    const text = renderTrackRecordPromptLine(null)
    expect(text).toContain('- With this user: no graded calls yet.')
    expect(text).toContain('- Across everyone: no graded calls yet.')
  })
})

describe('readTrackRecordLine', () => {
  it('accepts only a well-formed line', () => {
    expect(readTrackRecordLine({ right: 3, wrong: 1, same: 0, ratePct: null })).toEqual({ right: 3, wrong: 1, same: 0, ratePct: null })
    expect(readTrackRecordLine({ right: 3, wrong: 1, same: 0, ratePct: 140 })).toBeNull()
    expect(readTrackRecordLine({ right: -1, wrong: 1, same: 0, ratePct: null })).toBeNull()
    expect(readTrackRecordLine('12-5')).toBeNull()
  })
})
