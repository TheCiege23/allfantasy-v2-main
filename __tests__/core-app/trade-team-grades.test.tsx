/**
 * A grade for each team on a /core/trades card (2026-11-14). The owner: "make sure the grade is explicit
 * for each team … it only shows 1 grade and doesn't show which team that grade is for."
 *
 * Pinned: each side carries ITS team's letter (the first side `letter`, the second `partnerLetter`), the
 * verdict names the winner off those two letters, a fair trade says so, and an ungraded trade shows no
 * letter on either side.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

// The card's links (BoardActionLink) need the app router.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {}, refresh() {}, back() {}, forward() {} }),
  usePathname: () => '/core/trades',
  useSearchParams: () => new URLSearchParams(),
}))

import { TradesBoard } from '@/components/core-app/boards/TradesBoard'
import type { BoardTrade, TradesBoardData } from '@/lib/core-app/tradesBoard'
import { letterTone, teamGrades, tradeVerdict } from '@/lib/core-app/tradeTeamGrades'
import { tradeTeamGradesMessages } from '@/lib/core-app/messages/tradeTeamGrades'
import { missingMessages } from '@/lib/i18n/messages'

afterEach(() => cleanup())

const player = (id: string, name: string, value: number | null) => ({
  id,
  kind: 'player' as const,
  name,
  position: 'WR',
  team: null,
  imageUrl: null,
  value,
})

function trade(over: Partial<BoardTrade> = {}): BoardTrade {
  return {
    transactionId: 't1',
    season: 2026,
    week: 10,
    at: '2026-11-14T00:00:00.000Z',
    fromName: "CeeDee's Nutz",
    toName: 'Nosey Nabers',
    // `received` is fromName's side; `sent` went to toName.
    received: [player('p1', 'Daniel Jones', 1608)],
    sent: [player('p2', 'Some Pick Player', 1080)],
    letter: 'A',
    partnerLetter: 'F',
    getValue: 1608,
    giveValue: 1080,
    sharePct: 59.8,
    withheldReason: null,
    breakdown: [
      "CeeDee's Nutz came out well ahead — 1,608 in league value for 1,080.",
      "The most valuable asset was Daniel Jones, and CeeDee's Nutz got him.",
      "Graded on this league's values at the time of the trade (Nov 14) (Dynasty · Superflex · 14 teams).",
    ],
    ...over,
  }
}

function board(t: BoardTrade | null): TradesBoardData {
  return {
    pending: [],
    windows: [
      {
        leagueId: 'l1',
        leagueName: 'Going Deep League',
        platform: 'sleeper',
        logoUrl: null,
        deadlineWeek: null,
        noDeadline: true,
        weeksLeft: null,
        regularSeasonLength: 14,
        tradesOnFile: 14,
        latest: t,
        href: '/core/trades?league=l1',
        reasoning: 'Trades stay open all season in this league. 14 trades on file here.',
        freshTrade: true,
      },
    ],
    considered: 1,
    deadlineUnknown: 0,
    currentWeek: 10,
  }
}

const sides = (c: HTMLElement) => [...c.querySelectorAll('.af-bd-side')] as HTMLElement[]
const gradeOf = (side: HTMLElement) => side.querySelector('.af-tg-grade')?.getAttribute('aria-label') ?? null

describe('the rules', () => {
  it('needs both letters, or there are no team grades', () => {
    expect(teamGrades('A', 'F')).toEqual({ first: 'A', second: 'F' })
    expect(teamGrades('A', null)).toBeNull()
    expect(teamGrades(null, 'F')).toBeNull()
  })

  it('names the winner from the two letters, either way round, and calls equal letters fair', () => {
    expect(tradeVerdict({ first: 'A', second: 'F' })).toEqual({ kind: 'won', winner: 'first' })
    expect(tradeVerdict({ first: 'B', second: 'D' })).toEqual({ kind: 'won', winner: 'first' })
    expect(tradeVerdict({ first: 'D', second: 'B' })).toEqual({ kind: 'won', winner: 'second' })
    expect(tradeVerdict({ first: 'F', second: 'A' })).toEqual({ kind: 'won', winner: 'second' })
    expect(tradeVerdict({ first: 'C', second: 'C' })).toEqual({ kind: 'fair' })
  })

  it('colours A and B good, C even, D and F bad', () => {
    expect(['A', 'B', 'C', 'D', 'F'].map((l) => letterTone(l as 'A'))).toEqual(['good', 'good', 'warn', 'bad', 'bad'])
  })
})

describe('the card', () => {
  it('puts each team’s own grade beside its name, over what that team got', () => {
    const { container } = render(<TradesBoard data={board(trade())} allHref="#" />)
    const [first, second] = sides(container)
    expect(first.querySelector('.af-bd-side-label')?.textContent).toMatch(/^CeeDee's Nutz got/)
    expect(gradeOf(first)).toBe("CeeDee's Nutz: grade A")
    expect(first.textContent).toContain('Daniel Jones')
    expect(second.querySelector('.af-bd-side-label')?.textContent).toMatch(/^Nosey Nabers got/)
    expect(gradeOf(second)).toBe('Nosey Nabers: grade F')
    expect(second.textContent).toContain('Some Pick Player')
  })

  it('says who won, in words, above the two sides', () => {
    const { container, unmount } = render(<TradesBoard data={board(trade())} allHref="#" />)
    expect(container.querySelector('[data-testid="trade-verdict"]')?.textContent).toBe("CeeDee's Nutz won this trade")
    unmount()

    const flipped = render(<TradesBoard data={board(trade({ letter: 'D', partnerLetter: 'B' }))} allHref="#" />)
    expect(flipped.container.querySelector('[data-testid="trade-verdict"]')?.textContent).toBe('Nosey Nabers won this trade')
  })

  it('says "You won" for the reader, and calls a C–C trade fair', () => {
    const mine = render(<TradesBoard data={board(trade({ fromName: 'You' }))} allHref="#" />)
    expect(mine.container.querySelector('[data-testid="trade-verdict"]')?.textContent).toBe('You won this trade')
    expect(sides(mine.container)[0].querySelector('.af-bd-side-label')?.textContent).toMatch(/^You got/)
    mine.unmount()

    const fair = render(<TradesBoard data={board(trade({ letter: 'C', partnerLetter: 'C' }))} allHref="#" />)
    expect(fair.container.querySelector('[data-testid="trade-verdict"]')?.textContent).toBe('Fair trade: both sides got about the same')
    expect(sides(fair.container).map(gradeOf)).toEqual(["CeeDee's Nutz: grade C", 'Nosey Nabers: grade C'])
  })

  it('says the numbers once, for the first team, with the date', () => {
    const { container } = render(<TradesBoard data={board(trade())} allHref="#" />)
    expect(container.querySelector('[data-testid="trade-values"]')?.textContent).toBe(
      "CeeDee's Nutz got 1,608 in league value for 1,080. · Week 10, 2026",
    )
    const text = container.textContent ?? ''
    expect(text).not.toContain('Who got more value')
    expect(text).not.toContain('Latest grade')
    expect(text).not.toContain('came out well ahead')
    // The league's deadline sentence was under the grade looking like part of it.
    expect(text).not.toContain('Trades stay open all season in this league')
  })

  it('shows no grade on either side for an ungraded trade, and says why', () => {
    const { container } = render(
      <TradesBoard
        data={board(trade({ letter: null, partnerLetter: null, getValue: null, giveValue: null, withheldReason: 'Daniel Jones has no value yet.', breakdown: [] }))}
        allHref="#"
      />,
    )
    expect(container.querySelectorAll('.af-tg-grade')).toHaveLength(0)
    expect(container.querySelector('[data-testid="trade-verdict"]')).toBeNull()
    expect(container.querySelector('[data-testid="trade-not-graded"]')?.textContent).toBe('Not graded: Daniel Jones has no value yet.')
    expect(container.querySelector('[data-testid="trade-how-graded"]')).toBeNull()
  })

  it('a league with no trade still shows its deadline line', () => {
    const { container } = render(<TradesBoard data={board(null)} allHref="#" />)
    expect(container.textContent).toContain('Trades stay open all season in this league')
  })
})

describe('Spanish', () => {
  it('defines every message', () => {
    expect(missingMessages(tradeTeamGradesMessages, 'es')).toEqual([])
  })

  it('renders the grades and verdict in Spanish', () => {
    const { container } = render(<TradesBoard data={board(trade())} allHref="#" language="es" />)
    expect(container.querySelector('[data-testid="trade-verdict"]')?.textContent).toBe("CeeDee's Nutz ganó este cambio")
    expect(gradeOf(sides(container)[1])).toBe('Nosey Nabers: nota F')
  })
})
