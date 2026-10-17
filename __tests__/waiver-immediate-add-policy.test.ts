import { describe, expect, it } from 'vitest'
import { dailyModeLabel, isImmediateAddAllowedToday, type DailyPolicySnapshot } from '@/lib/waiver-wire/immediate-add-policy'

const policy = (over: Partial<DailyPolicySnapshot>): DailyPolicySnapshot => ({
  mode: 'free_agents',
  claimsAllowed: true,
  immediateAddsAllowed: true,
  immediateRefusal: null,
  ...over,
})

describe('isImmediateAddAllowedToday', () => {
  it('a free-agent day is an instant add even in a rolling league (Sleeper-style)', () => {
    expect(isImmediateAddAllowedToday({ waiverType: 'rolling', dailyPolicy: policy({}) })).toBe(true)
  })

  it('a waiver day uses the claim flow even in an FCFS league', () => {
    expect(
      isImmediateAddAllowedToday({
        waiverType: 'fcfs',
        dailyPolicy: policy({ mode: 'rolling', immediateAddsAllowed: false, immediateRefusal: 'waiver day' }),
      }),
    ).toBe(false)
  })

  it('waivers → free agents follows whether today’s run has cleared', () => {
    const before = policy({ mode: 'waivers_then_fa', immediateAddsAllowed: false, immediateRefusal: 'x' })
    const after = policy({ mode: 'waivers_then_fa', immediateAddsAllowed: true })
    expect(isImmediateAddAllowedToday({ waiverType: 'faab', dailyPolicy: before })).toBe(false)
    expect(isImmediateAddAllowedToday({ waiverType: 'faab', dailyPolicy: after })).toBe(true)
    expect(dailyModeLabel(after)).toMatch(/cleared/)
  })

  it('locked day refuses instant adds', () => {
    expect(
      isImmediateAddAllowedToday({
        waiverType: 'fcfs',
        dailyPolicy: policy({ mode: 'locked', claimsAllowed: false, immediateAddsAllowed: false }),
      }),
    ).toBe(false)
  })

  it('without a schedule the league type decides, unchanged', () => {
    expect(isImmediateAddAllowedToday({ waiverType: 'fcfs', dailyPolicy: null })).toBe(true)
    expect(isImmediateAddAllowedToday({ waiverType: 'rolling', instantFaAfterClear: true })).toBe(true)
    expect(isImmediateAddAllowedToday({ waiverType: 'rolling' })).toBe(false)
    expect(isImmediateAddAllowedToday(null)).toBe(false)
  })
})
