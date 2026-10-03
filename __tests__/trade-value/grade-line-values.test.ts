/**
 * 🛑 One matcher puts THE grade's per-asset values beside the assets every trade surface draws
 * (`lib/decision-os/trade/gradeLineValues.ts`). It exists because pairing by position printed a 1st's
 * value beside a 2nd (HailShiva, CaliMike85 ↔ Manifest Destiny, 2026-10-01): a completed trade's
 * letter is its FROZEN original, whose lines are in the order of whichever surface froze it.
 */
import { describe, expect, it } from 'vitest'
import { assetValues, pickKey } from '@/lib/decision-os/trade/gradeLineValues'
import type { TradeGradeLine } from '@/lib/decision-os/trade/tradeGrade'

const line = (side: 'give' | 'get', name: string, leagueValue: number | null): TradeGradeLine =>
  ({ side, name, marketValue: leagueValue, leagueValue }) as TradeGradeLine

describe('assetValues', () => {
  it('a frozen grade in another surface’s pick order still prices each pick by its year and round', () => {
    // Frozen by a surface that listed the 1st first; this surface lists the 2nd first.
    const lines = [line('get', '2027 1st', 3034), line('get', '2027 2nd', 1559), line('get', '2028 4th', 804)]
    expect(assetValues([{ label: '2027 round 2' }, { label: '2027 round 1' }, { label: '2028 round 4' }], lines, 'get'))
      .toEqual([1559, 3034, 804])
  })

  it('reads every pick spelling a surface prints — the email’s "1st round pick" included', () => {
    const lines = [line('get', '2026 2nd', 2830), line('get', '2026 1st', 6100)]
    expect(assetValues([{ label: '2026 1st round pick' }, { label: '2026 2nd round pick' }], lines, 'get')).toEqual([6100, 2830])
    expect(assetValues([{ label: '2026 Mid 1st' }, { label: '2026 Round 2' }], lines, 'get')).toEqual([6100, 2830])
  })

  it('a used pick is matched under the player drafted with it, not as a pick', () => {
    const lines = [line('give', 'Zachariah Branch', 910), line('give', 'Chris Brazzell', 546)]
    const out = assetValues(
      [{ label: '2026 round 3', gradedAs: 'Chris Brazzell' }, { label: '2026 round 2', gradedAs: 'Zachariah Branch' }],
      lines,
      'give',
    )
    expect(out).toEqual([546, 910])
  })

  it('a pricer’s canonical spelling still lands by place once the names and picks are matched', () => {
    const lines = [line('get', 'Kenneth Walker III', 4200), line('get', '2027 1st', 3000), line('get', 'Puka Nacua', 7000)]
    expect(assetValues([{ label: 'Puka Nacua' }, { label: '2027 round 1' }, { label: 'Kenneth Walker' }], lines, 'get'))
      .toEqual([7000, 3000, 4200])
  })

  it('never guesses: what is left unmatched and does not pair one-for-one gets no number', () => {
    const lines = [line('get', 'Someone Else', 100)]
    expect(assetValues([{ label: 'A' }, { label: 'B' }], lines, 'get')).toEqual([null, null])
  })

  it('reads only its own side', () => {
    const lines = [line('give', '2027 1st', 9), line('get', '2027 1st', 3034)]
    expect(assetValues([{ label: '2027 round 1' }], lines, 'get')).toEqual([3034])
  })
})

describe('pickKey', () => {
  it('one year and round out of every spelling, none out of a player', () => {
    expect(pickKey('2027 round 1')).toBe('2027:1')
    expect(pickKey('2027 1st')).toBe('2027:1')
    expect(pickKey('2026 2nd round pick')).toBe('2026:2')
    expect(pickKey('2027 Pick 1.04')).toBe('2027:1')
    expect(pickKey('Kenneth Walker III')).toBeNull()
  })
})
