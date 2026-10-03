import { describe, expect, it } from 'vitest'
import { gradeTrade, mirrorTradeGrade, type TradeGradeLine } from '@/lib/decision-os/trade/tradeGrade'

// Controlled fixtures test policy and symmetry; these are not an empirical accuracy calibration.
// The DK Metcalf case reproduces a previously inspected price-parity regression.
const cases = [
  { name: '1-for-1 even', give: [5000], get: [5000], letter: 'C', partner: 'C', action: 'review' },
  { name: '1-for-1 clear edge', give: [4000], get: [6000], letter: 'A', partner: 'F', action: 'accept' },
  { name: '2-for-1 equal quotes', give: [2500, 2500], get: [5000], letter: 'C', partner: 'C', action: 'review' },
  { name: '4-for-1 volume edge requires review', give: [5000], get: [2000, 2000, 2000, 2000], letter: 'A', partner: 'F', action: 'review' },
  { name: '4-for-1 consolidation also requires review', give: [1000, 1000, 1000, 1000], get: [6000], letter: 'A', partner: 'F', action: 'review' },
  { name: 'DK Metcalf for 2027 second, captured price regression', give: [1766], get: [1584], getKind: 'pick', letter: 'D', partner: 'B', action: 'counter' },
  { name: 'player for two future picks', give: [5000], get: [3000, 3000], getKind: 'pick', letter: 'B', partner: 'D', action: 'review' },
] as const

function args(c: typeof cases[number]) {
  const lines: TradeGradeLine[] = [
    ...c.give.map((v, i) => ({ side: 'give' as const, name: `Outgoing ${i}`, assetKind: 'player' as const, marketValue: v, leagueValue: v })),
    ...c.get.map((v, i) => ({ side: 'get' as const, name: `Incoming ${i}`, assetKind: ('getKind' in c ? c.getKind : 'player') as 'player' | 'pick', marketValue: v, leagueValue: v })),
  ]
  return {
    giveValue: c.give.reduce((a: number, b) => a + b, 0), getValue: c.get.reduce((a: number, b) => a + b, 0),
    giveMarket: c.give.reduce((a: number, b) => a + b, 0), getMarket: c.get.reduce((a: number, b) => a + b, 0),
    giveCount: c.give.length, getCount: c.get.length, unpriced: 0, basis: 'Controlled benchmark values',
    scoringApplied: false, needApplied: false, needGap: null, lines, moves: [],
  }
}

describe('P0 shared grade benchmark', () => {
  it.each(cases)('$name', c => {
    const input = args(c)
    const grade = gradeTrade(input)
    expect(grade.graded).toBe(true)
    if (!grade.graded) return
    expect([grade.letter, grade.partnerLetter, grade.action]).toEqual([c.letter, c.partner, c.action])
    const mirror = mirrorTradeGrade(grade)
    const swapped = gradeTrade({ ...input,
      giveValue: input.getValue, getValue: input.giveValue, giveMarket: input.getMarket, getMarket: input.giveMarket,
      giveCount: input.getCount, getCount: input.giveCount,
      lines: input.lines.map(l => ({ ...l, side: l.side === 'give' ? 'get' : 'give' })),
    })
    expect(mirror.graded && swapped.graded).toBe(true)
    if (mirror.graded && swapped.graded) expect([mirror.letter, mirror.action, mirror.recommendation]).toEqual([swapped.letter, swapped.action, swapped.recommendation])
  })
  it('withholds incomplete and corrupt prices instead of pricing the missing asset as zero', () => {
    const input = args(cases[0])
    expect(gradeTrade({ ...input, unpriced: 1 }).graded).toBe(false)
    for (const value of [NaN, Infinity, -Infinity]) expect(gradeTrade({ ...input, getValue: value }).graded).toBe(false)
    expect(gradeTrade({ ...input, lines: [{ ...input.lines[0]!, leagueValue: -1 }] }).graded).toBe(false)
  })
  it('a contender or rebuilder roster-fit gap cannot silently change the shared letter', () => {
    const input = args(cases[0])
    for (const needGap of ['Contender lacks starters', 'Rebuilder needs future picks']) {
      const result = gradeTrade({ ...input, needGap })
      expect(result.graded && result.letter).toBe('C')
    }
  })
})
