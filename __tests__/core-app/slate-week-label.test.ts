import { describe, expect, it } from 'vitest'
import { slateWeekLabel } from '@/lib/core-app/slateWeekLabel'

describe('slateWeekLabel — the top bar week chip', () => {
  it('names the sport, the phase and the week', () => {
    expect(slateWeekLabel('NFL', null, 9)).toBe('NFL WK 9')
    expect(slateWeekLabel('NCAAF', 'pre', 1)).toBe('NCAAF PRE WK 1')
    expect(slateWeekLabel('NFL', 'post', 2)).toBe('NFL POST WK 2')
  })

  it('shows no chip for week 0 — live /core read "NCAAB WK 0"', () => {
    expect(slateWeekLabel('NCAAB', null, 0)).toBeNull()
  })

  it('shows no chip for an unknown or nonsensical week', () => {
    expect(slateWeekLabel('NFL', null, null)).toBeNull()
    expect(slateWeekLabel('NFL', null, undefined)).toBeNull()
    expect(slateWeekLabel('NFL', null, -1)).toBeNull()
    expect(slateWeekLabel('NFL', null, Number.NaN)).toBeNull()
  })
})
