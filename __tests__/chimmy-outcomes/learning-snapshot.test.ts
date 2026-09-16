import { describe, expect, it } from 'vitest'
import {
  buildAdviceLearningSnapshot,
  CALIBRATION_MIN_SAMPLE,
  followThroughFor,
  LEARNING_HALF_LIFE_DAYS,
  MAX_USER_VERDICTS,
  parseAdviceLearningSnapshot,
  trackRecordsFrom,
  type AdviceOutcome,
} from '@/lib/chimmy-outcomes/learningSnapshot'

/**
 * Chimmy brief item 10: what the outcome loop learns, and that no single result can dominate it.
 */

const NOW = new Date('2026-10-20T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

let seq = 0
function call(over: Partial<AdviceOutcome> = {}): AdviceOutcome {
  seq += 1
  return {
    userId: 'u1',
    key: `L1:2026:5:p${seq}:q${seq}`,
    adviceType: 'start_sit',
    confidencePct: 90,
    givenAt: NOW,
    call: 'right',
    followed: 'yes',
    ...over,
  }
}
const calls = (n: number, over: Partial<AdviceOutcome> = {}) => Array.from({ length: n }, () => call(over))
const build = (outcomes: AdviceOutcome[]) => buildAdviceLearningSnapshot(outcomes, { now: NOW, complete: true, users: 1 })

describe('buildAdviceLearningSnapshot — calibration', () => {
  it('counts right/wrong start/sit calls in the band they were shown at', () => {
    const s = build([call({ confidencePct: 90 }), call({ confidencePct: 70, call: 'wrong' }), call({ confidencePct: 40 })])
    expect(s.calibration.start_sit.high).toMatchObject({ n: 1, right: 1, w: 1, wRight: 1, wShown: 0.9 })
    expect(s.calibration.start_sit.medium).toMatchObject({ n: 1, right: 0, w: 1, wRight: 0, wShown: 0.7 })
    expect(s.calibration.start_sit.low).toMatchObject({ n: 1, right: 1 })
    expect(s.totals.calls).toBe(3)
  })

  it('never counts a push, an add, or a call with no confidence shown', () => {
    const s = build([
      call({ call: 'same' }),
      call({ adviceType: 'add', call: undefined }),
      call({ confidencePct: null }),
      call({ confidencePct: 140 }),
    ])
    expect(s.calibration.start_sit).toEqual({})
    expect(s.totals.calls).toBe(0)
  })

  it('weighs a call by its age — one half-life old counts half', () => {
    const s = build([call({ givenAt: daysAgo(LEARNING_HALF_LIFE_DAYS), call: 'wrong' })])
    expect(s.calibration.start_sit.high!.w).toBeCloseTo(0.5, 4)
    expect(s.calibration.start_sit.high!.n).toBe(1)
  })
})

describe('trackRecordsFrom', () => {
  it('says nothing below the minimum sample', () => {
    // A literal, not the constant: a test written against the constant cannot catch it shrinking.
    expect(CALIBRATION_MIN_SAMPLE).toBe(20)
    expect(trackRecordsFrom(build(calls(19, { call: 'wrong' })))).toBeNull()
    expect(trackRecordsFrom(build(calls(20, { call: 'wrong' })))?.start_sit?.high?.n).toBe(20)
    expect(trackRecordsFrom(null)).toBeNull()
  })

  it('shrinks the observed rate toward the confidence that was shown', () => {
    // 20 calls shown at 90%, half right: (10 + 0.9 * 20) / (20 + 20) = 0.7 — not 0.5.
    const outcomes = [...calls(10, { confidencePct: 90 }), ...calls(10, { confidencePct: 90, call: 'wrong' })]
    const band = trackRecordsFrom(build(outcomes))!.start_sit!.high!
    expect(band.n).toBe(20)
    expect(band.shownRate).toBeCloseTo(0.9)
    expect(band.observedRate).toBeCloseTo(0.7)
  })

  it('a record that matches what was shown reads as calibrated', () => {
    const outcomes = [...calls(14, { confidencePct: 70 }), ...calls(6, { confidencePct: 70, call: 'wrong' })]
    const band = trackRecordsFrom(build(outcomes))!.start_sit!.medium!
    expect(band.observedRate).toBeCloseTo(band.shownRate)
  })

  it('one extra bad call barely moves a calibrated band', () => {
    const base = [...calls(14, { confidencePct: 70 }), ...calls(6, { confidencePct: 70, call: 'wrong' })]
    const before = trackRecordsFrom(build(base))!.start_sit!.medium!
    const after = trackRecordsFrom(build([...base, call({ confidencePct: 70, call: 'wrong' })]))!.start_sit!.medium!
    expect(before.observedRate - after.observedRate).toBeLessThan(0.02)
  })
})

describe('followThrough', () => {
  it('keeps each user’s followed/ignored verdicts, newest first', () => {
    const s = build([
      call({ key: 'old', followed: 'no', givenAt: daysAgo(10) }),
      call({ key: 'new', followed: 'yes', givenAt: daysAgo(1) }),
      call({ key: 'meh', followed: 'unclear' }),
      call({ userId: 'u2', key: 'x', followed: 'yes' }),
    ])
    expect(followThroughFor(s, 'u1').map((v) => [v.key, v.followed])).toEqual([
      ['new', true],
      ['old', false],
    ])
    expect(followThroughFor(s, 'u2')).toHaveLength(1)
    expect(followThroughFor(s, 'nobody')).toEqual([])
    expect(s.totals.verdicts).toBe(3)
  })

  it('records one verdict per key and caps the list', () => {
    const dup = build([call({ key: 'k' }), call({ key: 'k', followed: 'no' })])
    expect(followThroughFor(dup, 'u1')).toHaveLength(1)
    const many = build(Array.from({ length: MAX_USER_VERDICTS + 5 }, (_, i) => call({ key: `k${i}` })))
    expect(followThroughFor(many, 'u1')).toHaveLength(MAX_USER_VERDICTS)
  })
})

describe('parseAdviceLearningSnapshot', () => {
  it('round-trips what it wrote and refuses anything else', () => {
    const s = build(calls(3))
    expect(parseAdviceLearningSnapshot(JSON.parse(JSON.stringify(s)))).toMatchObject({ version: 1, totals: s.totals })
    expect(parseAdviceLearningSnapshot(null)).toBeNull()
    expect(parseAdviceLearningSnapshot({ ...s, version: 2 })).toBeNull()
    expect(parseAdviceLearningSnapshot({ version: 1, computedAt: 'x' })).toBeNull()
    expect(parseAdviceLearningSnapshot([])).toBeNull()
  })

  it('reads a stored verdict list defensively', () => {
    const s = build([])
    s.followThrough.u1 = [['a', 1, 0.5], ['b', 2 as never, 1], [7 as never, 0, 1], ['c', 0, Number.NaN]]
    expect(followThroughFor(s, 'u1')).toEqual([
      { key: 'a', followed: true, weight: 0.5 },
      { key: 'c', followed: false, weight: 1 },
    ])
  })
})
