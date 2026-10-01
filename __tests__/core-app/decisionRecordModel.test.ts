import { describe, expect, it } from 'vitest'
import { buildDecisionRecord, signedPoints } from '@/lib/core-app/decisionRecordModel'
import type { ChimmyAddReceipt, StartCallReceipt } from '@/lib/core-app/decisionReceipts'
import { MIN_DECIDED_FOR_USER_RATE } from '@/lib/chimmy-outcomes/trackRecord'

let n = 0
const call = (rec: number, alt: number, followed: StartCallReceipt['followed'], id?: string): StartCallReceipt => {
  const d = rec - alt
  return {
    id: id ?? `L1:2026:${++n}:a:b`,
    leagueId: 'L1',
    leagueName: 'Alpha',
    season: 2026,
    week: 2,
    slot: 'FLEX',
    recommended: { name: 'Rec', points: rec },
    instead: { name: 'Alt', points: alt },
    followed,
    call: Math.abs(d) < 1 ? 'same' : d > 0 ? 'right' : 'wrong',
    href: '/core/my-team?league=L1',
  }
}
const add = (added: number | null): ChimmyAddReceipt => ({
  id: `add:${++n}`,
  leagueId: 'L1',
  leagueName: 'Alpha',
  season: 2026,
  week: 2,
  playerName: 'Waiver Guy',
  confidencePct: 70,
  added: added == null ? null : { week: 2, points: added, starts: 1, leftWeek: null },
  href: '/core/waivers?league=L1',
})

describe('buildDecisionRecord', () => {
  it('is null when there is no resolved advice at all', () => {
    expect(buildDecisionRecord({ chimmy: [], autocoach: [], adds: [] })).toBeNull()
  })

  it('sums what following gained and what passing would have changed, signed', () => {
    const r = buildDecisionRecord({
      chimmy: [call(20, 10, 'yes'), call(8, 12, 'yes'), call(15, 5, 'no')],
      autocoach: [call(9, 3, 'no'), call(10, 10, 'unclear')],
      adds: [],
    })!
    expect(r.followed).toEqual({ count: 2, netPoints: 6 }) // +10 and −4
    expect(r.passed).toEqual({ count: 2, netPoints: 16 }) // the advice would have added 10 and 6
    expect(r.unclear).toBe(1)
    expect(r.calls).toMatchObject({ total: 5, right: 3, wrong: 1, same: 1 })
    expect(r.best).toMatchObject({ delta: 10, source: 'chimmy' })
  })

  it('counts one call advised by both Chimmy and AutoCoach once, as Chimmy’s', () => {
    const r = buildDecisionRecord({
      chimmy: [call(20, 10, 'yes', 'same-key')],
      autocoach: [call(20, 10, 'yes', 'same-key'), call(9, 3, 'yes')],
      adds: [],
    })!
    expect(r.calls.total).toBe(2)
    expect(r.bySource).toEqual({ chimmy: 1, autocoach: 1 })
  })

  it('shows a rate only at the track record’s own minimum sample', () => {
    const below = Array.from({ length: MIN_DECIDED_FOR_USER_RATE - 1 }, () => call(20, 10, 'yes'))
    expect(buildDecisionRecord({ chimmy: below, autocoach: [], adds: [] })!.calls.ratePct).toBeNull()
    const at = [...below, call(5, 10, 'yes')]
    expect(buildDecisionRecord({ chimmy: at, autocoach: [], adds: [] })!.calls.ratePct).toBe(Math.round((100 * (at.length - 1)) / at.length))
    // "same" never enters a rate, whatever its count.
    const sames = Array.from({ length: 10 }, () => call(10, 10, 'yes'))
    expect(buildDecisionRecord({ chimmy: sames, autocoach: [], adds: [] })!.calls.ratePct).toBeNull()
  })

  it('names no best call when nothing you followed paid', () => {
    expect(buildDecisionRecord({ chimmy: [call(5, 10, 'yes'), call(20, 5, 'no')], autocoach: [], adds: [] })!.best).toBeNull()
  })

  it('counts Chimmy’s adds you took and what they scored for you', () => {
    const r = buildDecisionRecord({ chimmy: [], autocoach: [], adds: [add(12.5), add(null), add(3.25)] })!
    expect(r.adds).toEqual({ advised: 3, added: 2, points: 15.8 })
    expect(r.calls.total).toBe(0)
  })
})

describe('signedPoints', () => {
  it('signs with a real minus and one decimal', () => {
    expect(signedPoints(41.2)).toBe('+41.2')
    expect(signedPoints(-3.5)).toBe('−3.5')
    expect(signedPoints(0)).toBe('0')
  })
})
