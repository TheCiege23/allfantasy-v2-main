import { describe, expect, it } from 'vitest'
import {
  ACCEPTED_EVENT,
  adviceKeyOf,
  BEHAVIOR_HALF_LIFE_DAYS,
  REJECTED_EVENT,
  tallyFollowThrough,
} from '@/lib/chimmy-outcomes/followThrough'

/**
 * "Did it / Not doing it" plus what Sleeper shows — one vote per piece of advice.
 */

const NOW = new Date('2026-10-20T12:00:00Z')
const accepted = (adviceKey?: string, createdAt?: Date) => ({
  actionType: ACCEPTED_EVENT,
  result: adviceKey ? { adviceKey } : {},
  createdAt,
})
const rejected = (adviceKey?: string, createdAt?: Date) => ({
  actionType: REJECTED_EVENT,
  result: adviceKey ? { adviceKey } : {},
  createdAt,
})

describe('tallyFollowThrough', () => {
  it('counts only your newest vote on a piece of advice', () => {
    // Newest first: you said "not doing it", after first saying "did it".
    const t = tallyFollowThrough([rejected('k1'), accepted('k1')], [], NOW)
    expect(t).toMatchObject({ accepted: 0, rejected: 1, total: 1, rawN: 1 })
  })

  it('lets the platform fill in only what you did not vote on', () => {
    const t = tallyFollowThrough(
      [rejected('k1')],
      [
        { key: 'k1', followed: true, weight: 1 },
        { key: 'k2', followed: true, weight: 0.5 },
      ],
      NOW,
    )
    expect(t).toMatchObject({ accepted: 0.5, rejected: 1, total: 1.5, rawN: 2, inferred: 1 })
  })

  it('counts older, keyless events one by one, as before', () => {
    const t = tallyFollowThrough([accepted(), accepted(), rejected()], [], NOW)
    expect(t).toMatchObject({ accepted: 2, rejected: 1, rawN: 3 })
  })

  it('ignores other event types', () => {
    const t = tallyFollowThrough([{ actionType: 'chimmy_alert_clicked', result: {} }], [], NOW)
    expect(t.rawN).toBe(0)
  })

  it('weighs a vote by its age, and an undated one fully', () => {
    const old = new Date(NOW.getTime() - BEHAVIOR_HALF_LIFE_DAYS * 86_400_000)
    const t = tallyFollowThrough([accepted('a', old), accepted('b')], [], NOW)
    expect(t.accepted).toBeCloseTo(1.5)
    expect(t.rawN).toBe(2)
  })
})

describe('adviceKeyOf', () => {
  it('reads a trimmed key and nothing else', () => {
    expect(adviceKeyOf({ adviceKey: ' L1:2026:5:add:77 ' })).toBe('L1:2026:5:add:77')
    expect(adviceKeyOf({ adviceKey: '' })).toBeNull()
    expect(adviceKeyOf({ adviceKey: 7 })).toBeNull()
    expect(adviceKeyOf({ adviceKey: 'x'.repeat(201) })).toBeNull()
    expect(adviceKeyOf(null)).toBeNull()
    expect(adviceKeyOf(['adviceKey'])).toBeNull()
  })
})
