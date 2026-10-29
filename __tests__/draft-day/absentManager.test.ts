import { describe, expect, it } from 'vitest'
import { absentClockSeconds, normalizeAbsentManagerRule, readAbsentManagerRule, trailingAutoPicks } from '@/lib/draft-day/absentManager'

const on = { enabled: true, missedPicks: 2, seconds: 15 }
const pick = (overall: number, rosterId: string, source: string, playerName = 'P') => ({ overall, rosterId, source, playerName })

describe('trailingAutoPicks', () => {
  it('counts the auto-picks at the end of a team\'s own picks only', () => {
    const picks = [pick(1, 'a', 'user'), pick(2, 'b', 'auto'), pick(3, 'a', 'auto'), pick(4, 'b', 'user'), pick(5, 'a', 'auto')]
    expect(trailingAutoPicks(picks, 'a')).toBe(2)
    expect(trailingAutoPicks(picks, 'b')).toBe(0)
  })
  it('one manual pick resets the count', () => {
    expect(trailingAutoPicks([pick(1, 'a', 'auto'), pick(2, 'a', 'auto'), pick(3, 'a', 'user')], 'a')).toBe(0)
  })
  it('skips keeper picks rather than counting them or treating them as a return', () => {
    expect(trailingAutoPicks([pick(1, 'a', 'auto'), pick(2, 'a', 'keeper'), pick(3, 'a', 'auto')], 'a')).toBe(2)
    expect(trailingAutoPicks([pick(1, 'a', 'user'), pick(2, 'a', 'keeper')], 'a')).toBe(0)
  })
  it('ignores commissioner-cleared empty rows', () => {
    expect(trailingAutoPicks([pick(1, 'a', 'auto'), pick(2, 'a', 'user', '  ')], 'a')).toBe(1)
  })
})

describe('absentClockSeconds', () => {
  const twoMissed = [pick(1, 'a', 'auto'), pick(2, 'b', 'user'), pick(3, 'a', 'auto')]
  it('gives the short clock once the team has missed enough picks in a row', () => {
    expect(absentClockSeconds({ rule: on, timerMode: 'per_pick', timerSeconds: 90, picks: twoMissed, nextRosterId: 'a' })).toBe(15)
  })
  it('uses the normal timer one miss short, for other teams, or when off', () => {
    expect(absentClockSeconds({ rule: on, timerMode: 'per_pick', timerSeconds: 90, picks: twoMissed.slice(0, 2), nextRosterId: 'a' })).toBeNull()
    expect(absentClockSeconds({ rule: on, timerMode: 'per_pick', timerSeconds: 90, picks: twoMissed, nextRosterId: 'b' })).toBeNull()
    expect(absentClockSeconds({ rule: { ...on, enabled: false }, timerMode: 'per_pick', timerSeconds: 90, picks: twoMissed, nextRosterId: 'a' })).toBeNull()
  })
  it('never lengthens a clock and stays out of untimed modes', () => {
    expect(absentClockSeconds({ rule: on, timerMode: 'per_pick', timerSeconds: 10, picks: twoMissed, nextRosterId: 'a' })).toBeNull()
    expect(absentClockSeconds({ rule: on, timerMode: 'soft_pause', timerSeconds: 90, picks: twoMissed, nextRosterId: 'a' })).toBeNull()
    expect(absentClockSeconds({ rule: on, timerMode: 'none', timerSeconds: 90, picks: twoMissed, nextRosterId: 'a' })).toBeNull()
    expect(absentClockSeconds({ rule: on, timerMode: 'overnight_pause', timerSeconds: 28800, picks: twoMissed, nextRosterId: 'a' })).toBe(15)
  })
})

describe('rule storage', () => {
  it('defaults off and clamps what is saved', () => {
    expect(readAbsentManagerRule({})).toEqual({ enabled: false, missedPicks: 2, seconds: 15 })
    expect(normalizeAbsentManagerRule({ enabled: true, missedPicks: 99, seconds: 1 })).toEqual({ enabled: true, missedPicks: 5, seconds: 10 })
    expect(normalizeAbsentManagerRule({ enabled: 'yes', missedPicks: 'x' })).toEqual({ enabled: false, missedPicks: 2, seconds: 15 })
  })
})
