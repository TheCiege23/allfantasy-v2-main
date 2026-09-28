/**
 * 🛑 A withheld grade prints no value on any asset (Guap's ruling, 2026-09-25). The board printed
 * the value book's display price beside a withheld letter — Omar Cooper read 15 on a card whose grade
 * had refused to price him — so the card answered, per asset, the question its letter declined to.
 */
import { describe, expect, it } from 'vitest'
import { valuesOnTheGrade, type TradeAsset } from '@/lib/core-app/tradesBoard'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'

const player = (id: string, value: number | null): TradeAsset =>
  ({ id, kind: 'player', name: id, position: 'WR', team: null, imageUrl: null, value }) as unknown as TradeAsset
const pick = (value: number | null): TradeAsset =>
  ({ id: 'pk', kind: 'pick', name: '2027 1st', value, pickSeason: 2027, pickRound: 1 }) as unknown as TradeAsset

const graded = (lines: Array<{ side: 'give' | 'get'; leagueValue: number | null }>): TradeGradeView =>
  ({
    graded: true,
    letter: 'B',
    partnerLetter: 'D',
    percentDiff: 14,
    lines: lines.map((l, i) => ({ ...l, name: `a${i}`, marketValue: l.leagueValue })),
  }) as unknown as TradeGradeView

describe('valuesOnTheGrade', () => {
  it('a withheld grade leaves every asset without a value — never the book price', () => {
    const g: TradeGradeView = { graded: false, reason: 'Omar Cooper has no value on this league’s chart.', basis: null }
    const out = valuesOnTheGrade([player('Omar Cooper', 15), player('Kaleb Johnson', 2400), pick(1800)], g, 'get')
    expect(out.map((a) => a.value)).toEqual([null, null, null])
    // names and order survive — only the prices go
    expect(out.map((a) => a.name)).toEqual(['Omar Cooper', 'Kaleb Johnson', '2027 1st'])
  })

  it('a graded card prints the league value the grade was taken on, per side', () => {
    const g = graded([
      { side: 'give', leagueValue: 4100 },
      { side: 'get', leagueValue: 3000 },
      { side: 'get', leagueValue: 1700 },
    ])
    expect(valuesOnTheGrade([player('a', 999), pick(999)], g, 'get').map((a) => a.value)).toEqual([3000, 1700])
    expect(valuesOnTheGrade([player('b', 999)], g, 'give').map((a) => a.value)).toEqual([4100])
  })

  it('a count mismatch keeps the book price rather than shifting values onto the wrong asset', () => {
    const g = graded([{ side: 'get', leagueValue: 3000 }])
    expect(valuesOnTheGrade([player('a', 11), player('b', 22)], g, 'get').map((a) => a.value)).toEqual([11, 22])
  })
})
