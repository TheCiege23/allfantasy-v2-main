import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { TradesData, TradeRecord } from '@/lib/core-app/trades'
import type { TradesBoardData } from '@/lib/core-app/tradesBoard'
import { HELP_TOPICS } from '@/lib/core-app/helpTopics'

/*
 * 🛑 A COMPLETED TRADE'S NUMBERS ARE ITS FROZEN ORIGINAL GRADE'S, NOT TODAY'S (2026-10-03).
 *
 * The value printed beside each asset on /core Trades is `assetValues(…, graded.lines, …)` — the
 * grade's OWN line values (`lib/decision-os/trade/gradeLineValues.ts`). For a completed Sleeper
 * trade that grade is `oneGradeForCompletedTrade`, whose view is the frozen original's `lines`
 * (`frozenCompletedGrade.ts` `withFrozenOriginal`: `{ ...original, frozenAt, current }`, where
 * `current` carries letters and totals only, never lines). The hover said "League value today".
 *
 * Then (2026-10-03) the hover went altogether: a `title` is invisible on a phone. What the number is
 * now lives in the Completed trades heading's "?" (`completedTradeGrade` in help-topics/trades.ts),
 * and that is what is pinned here — still the grade's value, never today's.
 *
 * And the cross-league Trades board said its grades "price both sides against current market
 * rank" — rank space was retired on 2026-09-25 and the letter is the frozen league-value grade
 * (`tradesBoard.ts` passes `original` to `gradeArchivedTrade`).
 */

const lang = vi.hoisted(() => ({ value: 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: lang.value }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {}, refresh() {}, back() {}, forward() {} }),
  usePathname: () => '/core/trades',
  useSearchParams: () => new URLSearchParams(),
}))

import Trades from '@/components/core-app/screens/Trades'
import TradesBoard from '@/components/core-app/boards/TradesBoard'

afterEach(() => {
  cleanup()
  lang.value = 'en'
})

const TIP = HELP_TOPICS.completedTradeGrade

// A frozen original: `frozenAt` set, today's re-grade beside it as `current` (letters and totals only).
const FROZEN = {
  graded: true, letter: 'D', partnerLetter: 'B', percentDiff: -25, label: 'Slightly favors opponent', sideAdvantage: 'opponent',
  action: 'counter', recommendation: 'x', giveValue: 2000, getValue: 1500, giveMarket: 2000, getMarket: 1500,
  basis: 'Dynasty · 12 teams', scoringApplied: true, needApplied: false, needGap: null, moves: [],
  lines: [
    { side: 'give', name: 'Jugador B', marketValue: 2000, leagueValue: 2000 },
    { side: 'get', name: 'Jugador A', marketValue: 1500, leagueValue: 1500 },
  ],
  frozenAt: '2026-09-28T16:00:00.000Z',
  current: { letter: 'C', partnerLetter: 'C', giveValue: 1800, getValue: 1750 },
}

function tradesData(): TradesData {
  const record = {
    transactionId: 'SL1:tx-1', season: 2026, week: 1, rosterIds: ['1', '2'], yourSide: 'in',
    playersIn: 1, playersOut: 1, picks: 0, partnerTeamName: 'Rivales', at: new Date('2026-09-05T22:16:13Z'),
    players: [
      { manager: 'Tu equipo', isYou: true, received: [{ sleeperId: '1', name: 'Jugador A', position: 'RB', team: 'ATL' }] },
      { manager: 'Rivales', isYou: false, received: [{ sleeperId: '2', name: 'Jugador B', position: 'WR', team: 'DET' }] },
    ],
    leagueGrade: FROZEN,
  } as unknown as TradeRecord
  return {
    league: { id: 'l1', name: 'Liga Uno', platform: 'sleeper' },
    gradingContext: { available: false, reason: 'no grading context' },
    deadline: { available: false, reason: 'this league’s trade deadline is not ingested' },
    inbox: { available: true, data: [] }, sent: { available: true, data: [] },
    history: { available: true, data: [record] },
    grades: { available: false, reason: 'no trades on file for this league' },
    canonicalHistory: true,
  } as unknown as TradesData
}

const valueTitles = (container: HTMLElement) =>
  [...container.querySelectorAll('em.af-tr-asset-value')].map((n) => n.getAttribute('title'))
const tipText = (container: HTMLElement) => container.querySelector('.af-tr-history-head .af-info-pop')?.textContent ?? ''

describe('/core Trades — the value beside each asset', () => {
  it('names it as the grade’s value, never as today’s, on a frozen completed trade', () => {
    const { container } = render(<Trades data={tradesData()} />)
    const titles = valueTitles(container)
    // Both assets carry the grade's own line value — the frozen original's, not today's.
    expect([...container.querySelectorAll('em.af-tr-asset-value')].map((n) => n.textContent)).toEqual(['1,500', '2,000'])
    // No hover-only title; the heading's "?" says what the number is.
    expect(titles).toEqual([null, null])
    expect(tipText(container)).toContain(TIP.en.body)
    expect(TIP.en.body).toContain('a number beside an asset is the value that grade used for it')
    expect(container.innerHTML).not.toMatch(/value today/i)
  })

  it('says the same in Spanish, and the Spanish no longer claims "actual"', () => {
    lang.value = 'es'
    const { container } = render(<Trades data={tradesData()} />)
    expect(valueTitles(container)).toEqual([null, null])
    expect(tipText(container)).toContain(TIP.es.body)
    expect(TIP.es.body).toContain('el valor que usó esa calificación')
    expect(container.innerHTML).not.toContain('Valor actual en esta liga')
  })
})

describe('Trades board — what the footer says a grade is', () => {
  const board: TradesBoardData = {
    pending: [],
    windows: [{
      leagueId: 'l1', leagueName: 'Ice Kings', platform: 'sleeper', logoUrl: null, deadlineWeek: 11, noDeadline: false,
      weeksLeft: 1, regularSeasonLength: 14, tradesOnFile: 1, latest: null, href: '/core/trades?league=l1',
      reasoning: '1 week until the week 11 deadline. 1 trade on file here.',
    }],
    considered: 1,
    deadlineUnknown: 0,
    currentWeek: 10,
  } as unknown as TradesBoardData

  it('describes the frozen league-value grade, not a market-rank one', () => {
    const { container } = render(<TradesBoard data={board} allHref="/core/trades?all=1" />)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/market rank/i)
    expect(text).toContain('Grades price both sides on this league’s own values.')
    expect(text).toContain('A completed trade keeps the grade it got the first time AllFantasy graded it')
    // The withheld-letter rule the footer already stated is unchanged.
    expect(text).toMatch(/shown with its reason instead of a letter/)
  })
})
