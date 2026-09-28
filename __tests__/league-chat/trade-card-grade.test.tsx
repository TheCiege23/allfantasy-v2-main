/**
 * League chat trade cards show THE grade (2026-09-27): both teams' letters on the card, and Chimmy's
 * message worded from them — never from the private market-score letter the take used to run on.
 */
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  cardValues,
  gradedTradeTakeText,
  readTradeCardGrade,
  tradeCardGradeLine,
  type TradeCardGrade,
} from '@/lib/league-chat/tradeCardGradeView'
import { TradeCardView } from '@/components/core-app/comms/TradeCardView'

const graded = (over: Partial<Extract<TradeCardGrade, { graded: true }>> = {}): TradeCardGrade => ({
  graded: true,
  letter: 'D',
  partnerLetter: 'B',
  basis: 'today',
  valueGave: 6100,
  valueGot: 5200,
  ...over,
})

describe('gradedTradeTakeText', () => {
  it('names who comes out ahead from the LETTERS — the better letter, whichever side it is on', () => {
    expect(gradedTradeTakeText({ manager: 'Casey', partner: 'Jordan', grade: graded(), seed: 't1' })).toMatch(
      /^League grade: Casey D, Jordan B — Jordan comes out ahead, on this league's values today\. /,
    )
    expect(
      gradedTradeTakeText({ manager: 'Casey', partner: 'Jordan', grade: graded({ letter: 'A', partnerLetter: 'F', basis: 'at-proposal' }), seed: 't1' }),
    ).toMatch(/^League grade: Casey A, Jordan F — Casey comes out ahead, graded when it was proposed\. /)
  })

  it('an equal pair is even, and a missing partner name still reads', () => {
    expect(gradedTradeTakeText({ manager: 'Casey', partner: null, grade: graded({ letter: 'C', partnerLetter: 'C' }), seed: 't1' })).toMatch(
      /^League grade: Casey C, their trade partner C — even, on this league's values today\. /,
    )
  })

  it('is deterministic per trade, and a withheld grade has no take', () => {
    const a = gradedTradeTakeText({ manager: 'Casey', partner: 'Jordan', grade: graded(), seed: 'tx-9' })
    expect(gradedTradeTakeText({ manager: 'Casey', partner: 'Jordan', grade: graded(), seed: 'tx-9' })).toBe(a)
    expect(gradedTradeTakeText({ manager: 'Casey', partner: 'Jordan', grade: { graded: false, reason: 'x' }, seed: 't' })).toBeNull()
  })
})

describe('readTradeCardGrade (metadata is data from the database)', () => {
  it('reads a graded or withheld grade and rejects anything else', () => {
    expect(readTradeCardGrade({ graded: true, letter: 'd', partnerLetter: 'B', basis: 'at-proposal', valueGave: 10 })).toEqual({
      graded: true,
      letter: 'D',
      partnerLetter: 'B',
      basis: 'at-proposal',
      valueGave: 10,
      valueGot: null,
    })
    expect(readTradeCardGrade({ graded: false, reason: ' no values ' })).toEqual({ graded: false, reason: 'no values' })
    expect(readTradeCardGrade({ graded: true, letter: 'Z', partnerLetter: 'B' })).toBeNull()
    expect(readTradeCardGrade({ graded: false, reason: '' })).toBeNull()
    expect(readTradeCardGrade('A')).toBeNull()
    expect(readTradeCardGrade(null)).toBeNull()
  })
})

describe('cardValues', () => {
  const take = { sides: [{ sent: 3560, received: 8800 }, {}] as const }

  it('a graded card shows only the league values its letters were taken on — never the market take', () => {
    expect(cardValues(graded(), take)).toEqual({ grade: graded(), valueGave: 6100, valueGot: 5200, valueBasis: 'league' })
    expect(cardValues(graded({ valueGave: null, valueGot: null }), take)).toMatchObject({ valueGave: null, valueGot: null, valueBasis: null })
  })

  it('no grade (or a withheld one) keeps the market take, labelled market', () => {
    expect(cardValues(null, take)).toEqual({ valueGave: 3560, valueGot: 8800, valueBasis: 'market' })
    expect(cardValues({ graded: false, reason: 'r' }, null)).toEqual({ grade: { graded: false, reason: 'r' }, valueGave: null, valueGot: null, valueBasis: null })
  })
})

describe('TradeCardView', () => {
  const base = {
    manager: 'Casey',
    partner: 'Jordan',
    gave: [{ id: '6813', name: 'Travis Kelce' }],
    got: [{ id: '8148', name: "Ja'Marr Chase" }],
    picksGave: 0,
    picksGot: 0,
    season: 2026,
    week: 3,
  }

  it('draws both letters with their basis, and labels the numbers as league value', () => {
    render(<TradeCardView card={{ ...base, grade: graded(), valueGave: 6100, valueGot: 5200, valueBasis: 'league' }} />)
    expect(screen.getByTestId('trade-card-grade').textContent).toBe("Grade: Casey D · Jordan B · on this league's values today")
    expect(screen.getByText("League value, on this league's chart.")).toBeTruthy()
  })

  it('a withheld grade says why with no letter', () => {
    render(<TradeCardView card={{ ...base, grade: { graded: false, reason: 'only two-team trades are graded' } }} />)
    expect(screen.getByTestId('trade-card-grade-withheld').textContent).toBe('Not graded: only two-team trades are graded')
  })

  it('a card from before the grade renders as it did — market value, no grade line', () => {
    render(<TradeCardView card={{ ...base, valueGave: 3560, valueGot: 8800 }} />)
    expect(screen.queryByTestId('trade-card-grade')).toBeNull()
    expect(screen.getByText('Market value, from FantasyCalc.')).toBeTruthy()
  })

  it('the line helper matches what the card prints', () => {
    expect(tradeCardGradeLine('Casey', 'Jordan', graded())).toBe('Casey D · Jordan B')
  })
})
