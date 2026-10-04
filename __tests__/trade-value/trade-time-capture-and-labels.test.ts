/**
 * The pure halves of "priced at the time of the trade" (Guap's ruling, 2026-10-03):
 *
 *  - WHICH capture prices a trade (`tradeTimeCapture.ts`): the latest one TAKEN at or before the
 *    trade (captures are stamped at UTC midnight but taken at 10:00 UTC), at most a day old, never one
 *    taken after the trade;
 *  - HOW every surface says it (`gradeMoment`), in English and Spanish — a trade-date letter, the
 *    honest first-graded label (Decision 1) with the day gap, and a v1 original that nothing has
 *    checked yet, which must NOT claim there is no market record from the trade date.
 */
import { describe, expect, it } from 'vitest'
import {
  captureTakenAt,
  chooseTradeTimeCapture,
  sleeperTransactionTime,
  tradeTimeOf,
} from '@/lib/decision-os/trade/tradeTimeCapture'
import { gradeMoment, gradeMomentToSpanish } from '@/lib/decision-os/trade/gradeMoment'
import { tradeUiCopy } from '@/lib/core-app/tradeUiCopy'
import { readTradeCardGrade, tradeCardGradeBasisLabel } from '@/lib/league-chat/tradeCardGradeView'
import { tradeGradeLabel } from '@/lib/activity/tradeGradeLabel'

const DAYS = ['2026-09-21', '2026-09-22', '2026-09-24']
const at = (iso: string) => new Date(iso)

describe('which capture prices a trade', () => {
  it('a capture stamped D is taken at 10:00 UTC on D', () => {
    expect(captureTakenAt('2026-09-24').toISOString()).toBe('2026-09-24T10:00:00.000Z')
  })

  it('before 10:00 UTC on D → capture D-1; at or after 10:00 → capture D', () => {
    expect(chooseTradeTimeCapture(DAYS, at('2026-09-22T09:59:59Z'))?.day).toBe('2026-09-21')
    expect(chooseTradeTimeCapture(DAYS, at('2026-09-22T10:00:00Z'))?.day).toBe('2026-09-22')
    expect(chooseTradeTimeCapture(DAYS, at('2026-09-22T23:59:00Z'))?.day).toBe('2026-09-22')
  })

  it('never a capture taken after the trade', () => {
    expect(chooseTradeTimeCapture(['2026-09-24'], at('2026-09-24T09:00:00Z'))).toBeNull()
  })

  it('at most one day between the capture and the trade — a gap in the series is not covered', () => {
    // Sep 23 is missing: Sep 22's capture covers the trade only until 10:00 UTC on the 23rd.
    expect(chooseTradeTimeCapture(DAYS, at('2026-09-23T10:00:00Z'))?.day).toBe('2026-09-22')
    expect(chooseTradeTimeCapture(DAYS, at('2026-09-23T10:00:01Z'))).toBeNull()
    expect(chooseTradeTimeCapture(DAYS, at('2026-09-24T09:59:00Z'))).toBeNull()
    // Before the series began, or with no trade time: nothing.
    expect(chooseTradeTimeCapture(DAYS, at('2026-08-01T12:00:00Z'))).toBeNull()
    expect(chooseTradeTimeCapture(DAYS, null)).toBeNull()
    expect(chooseTradeTimeCapture([], at('2026-09-24T12:00:00Z'))).toBeNull()
  })

  it('order of the day list does not matter, and malformed days are ignored', () => {
    expect(chooseTradeTimeCapture(['2026-09-24', 'nonsense', '2026-09-22', '2026-09-21'], at('2026-09-24T12:00:00Z'))?.day).toBe('2026-09-24')
  })
})

describe('when a trade happened', () => {
  it('reads a Sleeper snowflake id: (id >> 22) + 1454362509301', () => {
    expect(sleeperTransactionTime('1408864577436778496')?.toISOString()).toBe('2026-09-24T15:00:00.000Z')
    // Any id form that ends in the transaction id.
    expect(sleeperTransactionTime('sl-1:1408864577436778496')?.toISOString()).toBe('2026-09-24T15:00:00.000Z')
    expect(sleeperTransactionTime('tx-1')).toBeNull()
    expect(sleeperTransactionTime('')).toBeNull()
  })

  it('prefers the completion time; Sleeper’s 0 means "not set", not 1970', () => {
    expect(tradeTimeOf({ completedAt: '2026-09-25T01:00:00Z', tradeId: '1408864577436778496' })?.toISOString()).toBe('2026-09-25T01:00:00.000Z')
    expect(tradeTimeOf({ completedAt: 0, tradeId: '1408864577436778496' })?.toISOString()).toBe('2026-09-24T15:00:00.000Z')
    expect(tradeTimeOf({ completedAt: '', tradeId: 'x' })).toBeNull()
  })
})

const FROZEN_AT = '2026-10-03T16:00:00.000Z'
const TRADE_AT = '2026-09-14T18:00:00.000Z'

describe('every surface says how a frozen letter was priced — EN and ES', () => {
  it('trade_date', () => {
    const g = { frozenAt: FROZEN_AT, frozenBasis: 'trade_date' as const, pricedAsOf: '2026-09-14', tradeAt: TRADE_AT }
    expect(gradeMoment(g)).toBe('at the time of the trade (Sep 14)')
    expect(gradeMoment(g, 'es')).toBe('en la fecha del traspaso (14 sep)')
  })

  it('first_graded (Decision 1): the date it was priced, the gap, and that no record covers the trade date', () => {
    const g = { frozenAt: FROZEN_AT, frozenBasis: 'first_graded' as const, pricedAsOf: '2026-09-30T15:00:00.000Z', tradeAt: TRADE_AT }
    expect(gradeMoment(g)).toBe('from Sep 30, 2026, 16 days after the trade (no market record from the trade date)')
    expect(gradeMoment(g, 'es')).toBe('del 30 sep 2026, 16 días después del traspaso (no hay registro del mercado de la fecha del traspaso)')
    expect(gradeMoment({ ...g, pricedAsOf: '2026-09-15T15:00:00.000Z' })).toBe('from Sep 15, 2026, 1 day after the trade (no market record from the trade date)')
    expect(gradeMoment({ ...g, pricedAsOf: '2026-09-14T23:00:00.000Z' })).toBe('from Sep 14, 2026, the day of the trade (no market record from the trade date)')
  })

  it('a v1 original (no basis): the old wording, never a claim about the trade-date record', () => {
    const g = { frozenAt: '2026-09-30T15:00:00.000Z', tradeAt: TRADE_AT }
    expect(gradeMoment(g)).toBe('when first graded Sep 30')
    expect(gradeMoment(g, 'es')).toBe('cuando se calificó por primera vez el 30 sep')
    expect(gradeMoment({ frozenAt: '2026-09-30T15:00:00.000Z', frozenBasis: null })).toBe('when first graded Sep 30')
  })

  it('a live grade', () => {
    expect(gradeMoment(null)).toBe('today')
    expect(gradeMoment({ frozenAt: null }, 'es')).toBe('de hoy')
  })

  it('the Spanish switch translates each English phrase, alone or inside the breakdown sentence', () => {
    for (const g of [
      { frozenAt: FROZEN_AT, frozenBasis: 'trade_date' as const, pricedAsOf: '2026-09-14', tradeAt: TRADE_AT },
      { frozenAt: FROZEN_AT, frozenBasis: 'first_graded' as const, pricedAsOf: FROZEN_AT, tradeAt: TRADE_AT },
      { frozenAt: FROZEN_AT },
      null,
    ]) {
      expect(gradeMomentToSpanish(gradeMoment(g))).toBe(gradeMoment(g, 'es'))
      // A bare "today" is the shared dictionary's word ("hoy"); every frozen phrase is translated here.
      if (g) expect(tradeUiCopy(gradeMoment(g), 'es')).toBe(gradeMoment(g, 'es'))
      expect(tradeUiCopy(`Graded on this league's values ${gradeMoment(g)} (Dynasty · 1QB · 12 teams · PPR).`, 'es'))
        .toBe(`Calificado con los valores de esta liga ${gradeMoment(g, 'es')} (Dynasty · 1QB · 12 teams · PPR).`)
    }
    expect(gradeMomentToSpanish('not a moment')).toBeNull()
  })

  it('league chat cards carry the basis through stored metadata and say it', () => {
    const card = readTradeCardGrade({ graded: true, letter: 'B', partnerLetter: 'D', basis: 'first-graded', frozenAt: FROZEN_AT, frozenBasis: 'trade_date', pricedAsOf: '2026-09-14', tradeAt: TRADE_AT })
    expect(card).toMatchObject({ basis: 'first-graded', frozenBasis: 'trade_date', tradeAt: TRADE_AT })
    expect(tradeCardGradeBasisLabel(card as never)).toBe("on this league's values at the time of the trade (Sep 14)")
    // An older card, stored before the basis existed, keeps the old wording.
    const old = readTradeCardGrade({ graded: true, letter: 'B', partnerLetter: 'D', basis: 'first-graded', frozenAt: FROZEN_AT })
    expect(tradeCardGradeBasisLabel(old as never)).toBe("on this league's values when first graded Oct 3")
  })

  it('League Buzz says it too', () => {
    const label = tradeGradeLabel({
      graded: true, basis: 'first-graded', sides: [{ name: 'A', letter: 'B' }, { name: 'B', letter: 'D' }],
      moment: { frozenAt: FROZEN_AT, frozenBasis: 'trade_date', pricedAsOf: '2026-09-14', tradeAt: TRADE_AT },
    })
    expect(label).toMatchObject({ kind: 'graded', basis: 'on this league’s values at the time of the trade (Sep 14)' })
  })
})
