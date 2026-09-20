import { describe, expect, it } from 'vitest'

import { buildTradeBreakdown, type BreakdownAsset } from '@/lib/core-app/tradeBreakdown'

/*
 * The card carried a letter and a percentage and nothing that said WHY, so these tests are
 * mostly about the sentence agreeing with the badge beside it. A breakdown that contradicts
 * the grade is worse than no breakdown: the reader has no way to tell which half is wrong.
 */

const player = (name: string, rank: number, position: string | null = 'WR'): BreakdownAsset => ({
  name,
  kind: 'player',
  position,
  rank,
})

const pick = (name: string, rank: number): BreakdownAsset => ({
  name,
  kind: 'pick',
  position: null,
  rank,
})

describe('buildTradeBreakdown — the verdict line', () => {
  /*
   * 🛑 THE LETTER IS AN INPUT, SO THIS IS THE TEST THAT PINS THE ONE THING THE FEATURE
   * CANNOT GET WRONG: which manager the sentence says came out ahead. Naming the wrong side
   * is invisible to a typecheck, invisible to the grader, and the first thing a manager
   * would notice.
   */
  it.each([
    ['A' as const, 71, /^You came out well ahead/],
    ['B' as const, 58, /^You got the better end/],
    ['C' as const, 50, /^A near-even deal/],
    ['D' as const, 41, /^Mike got the better end/],
    ['F' as const, 28, /^Mike came out well ahead/],
  ])('letter %s names the right beneficiary', (letter, sharePct, expected) => {
    const [verdict] = buildTradeBreakdown({
      received: [player('A.J. Brown', 12)],
      gave: [player('Chris Olave', 40)],
      letter,
      sharePct,
      receiverLabel: 'You',
      partnerLabel: 'Mike',
    })
    expect(verdict).toMatch(expected)
  })

  it('states both halves of a near-even split so they sum to 100', () => {
    const [verdict] = buildTradeBreakdown({
      received: [player('A.J. Brown', 12)],
      gave: [player('Chris Olave', 14)],
      letter: 'C',
      sharePct: 52.4,
      receiverLabel: 'You',
      partnerLabel: 'Mike',
    })
    expect(verdict).toBe('A near-even deal — 52% to You, 48% to Mike.')
  })
})

describe('buildTradeBreakdown — the best asset', () => {
  /*
   * 🛑 A LOWER RANK IS A BETTER ASSET (rank 1 is the #1 player), so the selection runs
   * through `rankToValue` rather than comparing ranks. Getting this backwards names the
   * WORST asset in the deal as its headline, and every sentence still reads fluently.
   */
  it('picks the highest-value asset, not the highest rank number', () => {
    const out = buildTradeBreakdown({
      received: [player('Puka Nacua', 8)],
      gave: [player('Rome Odunze', 96), player('Jaxon Smith-Njigba', 120)],
      letter: 'A',
      sharePct: 68,
      receiverLabel: 'You',
      partnerLabel: 'Mike',
    })
    expect(out[1]).toBe('The most valuable asset was Puka Nacua, and You got him.')
  })

  it('calls a pick "it" and a player "him"', () => {
    const out = buildTradeBreakdown({
      received: [pick('2027 1st', 10)],
      gave: [player('Rome Odunze', 96)],
      letter: 'A',
      sharePct: 70,
      receiverLabel: 'You',
      partnerLabel: 'Mike',
    })
    expect(out[1]).toBe('The most valuable asset was 2027 1st, and You got it.')
  })

  /*
   * The case the letter alone cannot show: winning on total value while giving up the best
   * player in the deal. Depth for a star is an ordinary trade shape and the badge hides it.
   */
  it('flags quality and quantity pulling apart', () => {
    const out = buildTradeBreakdown({
      received: [player('Rome Odunze', 60), player('Jayden Reed', 64), player('Khalil Shakir', 70)],
      gave: [player('Puka Nacua', 8)],
      letter: 'B',
      sharePct: 58,
      receiverLabel: 'You',
      partnerLabel: 'Mike',
    })
    expect(out[1]).toMatch(/^Quality and quantity pulled apart: the best single asset was Puka Nacua, and Mike got him/)
  })

  it('does not claim a split when the value and the best asset agree', () => {
    const out = buildTradeBreakdown({
      received: [player('Puka Nacua', 8)],
      gave: [player('Rome Odunze', 96)],
      letter: 'A',
      sharePct: 72,
      receiverLabel: 'You',
      partnerLabel: 'Mike',
    })
    expect(out[1]).not.toMatch(/pulled apart/)
  })

  /*
   * An even deal has no winner on total value, so there is no tension for the best asset to
   * be in — claiming one would invent a loser the grade explicitly declined to name.
   */
  it('never claims a split on an even deal', () => {
    const out = buildTradeBreakdown({
      received: [player('Rome Odunze', 60)],
      gave: [player('Puka Nacua', 8)],
      letter: 'C',
      sharePct: 49,
      receiverLabel: 'You',
      partnerLabel: 'Mike',
    })
    expect(out[1]).not.toMatch(/pulled apart/)
  })

  it('breaks a tie deterministically rather than by sort stability', () => {
    const args = {
      received: [pick('2028 2nd', 40)],
      gave: [pick('2029 2nd', 40)],
      letter: 'C' as const,
      sharePct: 50,
      receiverLabel: 'You',
      partnerLabel: 'Mike',
    }
    const first = buildTradeBreakdown(args)[1]
    expect(buildTradeBreakdown(args)[1]).toBe(first)
    // Received is scanned first, so an exact tie resolves to the received side.
    expect(first).toContain('2028 2nd')
  })
})

describe('buildTradeBreakdown — what moved', () => {
  it('counts players by position and names picks', () => {
    const out = buildTradeBreakdown({
      received: [player('Bijan Robinson', 4, 'RB')],
      gave: [player('A.J. Brown', 12, 'WR'), player('Dalton Kincaid', 90, 'TE'), pick('2027 1st', 30)],
      letter: 'C',
      sharePct: 48,
      receiverLabel: 'You',
      partnerLabel: 'Mike',
    })
    expect(out[2]).toBe('You sent 2 players (WR, TE) plus 2027 1st and got back 1 player (RB).')
  })

  it('does not print an empty position list when the book has no position', () => {
    const out = buildTradeBreakdown({
      received: [player('Unknown Guy', 300, null)],
      gave: [pick('2027 3rd', 200)],
      letter: 'C',
      sharePct: 50,
      receiverLabel: 'You',
      partnerLabel: 'Mike',
    })
    expect(out[2]).toBe('You sent 2027 3rd and got back 1 player.')
  })

  it('dedupes repeated positions', () => {
    const out = buildTradeBreakdown({
      received: [player('WR One', 20, 'WR'), player('WR Two', 30, 'WR')],
      gave: [player('RB One', 25, 'RB')],
      letter: 'B',
      sharePct: 57,
      receiverLabel: 'You',
      partnerLabel: 'Mike',
    })
    expect(out[2]).toBe('You sent 1 player (RB) and got back 2 players (WR).')
  })
})

describe('buildTradeBreakdown — refusals', () => {
  /*
   * `gradeTrade` refuses a letter outright when a side is empty, so this is unreachable
   * through the board. Asserted anyway because the function is exported and the next caller
   * need not come through that path.
   */
  it.each([
    ['no received', [] as BreakdownAsset[], [player('A.J. Brown', 12)]],
    ['no gave', [player('A.J. Brown', 12)], [] as BreakdownAsset[]],
  ])('returns nothing when a side is empty (%s)', (_label, received, gave) => {
    expect(
      buildTradeBreakdown({
        received,
        gave,
        letter: 'C',
        sharePct: 50,
        receiverLabel: 'You',
        partnerLabel: 'Mike',
      }),
    ).toEqual([])
  })

  it('clamps a share outside 0–100 rather than printing it', () => {
    const [verdict] = buildTradeBreakdown({
      received: [player('A.J. Brown', 12)],
      gave: [player('Chris Olave', 40)],
      letter: 'A',
      sharePct: 140,
      receiverLabel: 'You',
      partnerLabel: 'Mike',
    })
    expect(verdict).toContain('100%')
  })
})
