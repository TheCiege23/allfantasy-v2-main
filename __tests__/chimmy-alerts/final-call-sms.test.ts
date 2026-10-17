import { describe, expect, it } from 'vitest'
import { FINAL_CALL_SMS_MAX, finalCallSms, injurySmsEnabled } from '@/lib/chimmy-alerts/finalCallSms'

describe('injurySmsEnabled', () => {
  it('is on unless switched off', () => {
    expect(injurySmsEnabled({})).toBe(true)
    expect(injurySmsEnabled({ INJURY_ALERTS_SMS: 'on' })).toBe(true)
    for (const v of ['off', 'OFF', '0', 'false', ' off ']) expect(injurySmsEnabled({ INJURY_ALERTS_SMS: v })).toBe(false)
  })
})

describe('finalCallSms', () => {
  it('says the call, the fix and the link', () => {
    expect(finalCallSms({ title: 'Jeremiyah Love is Out and still starting', body: 'Guillotine League 26: start Tyler Allgeier.' }, 'https://allfantasy.ai/core/players?q=x')).toBe(
      'Final call: Jeremiyah Love is Out and still starting. Guillotine League 26: start Tyler Allgeier. Fix: https://allfantasy.ai/core/players?q=x',
    )
  })

  it('trims the body, never the link, to fit', () => {
    const url = 'https://allfantasy.ai/core/players'
    const out = finalCallSms({ title: 'X is Out', body: 'y'.repeat(1000) }, url)
    expect(out.length).toBeLessThanOrEqual(FINAL_CALL_SMS_MAX)
    expect(out.endsWith(`Fix: ${url}`)).toBe(true)
    expect(out).toContain('…')
  })
})
