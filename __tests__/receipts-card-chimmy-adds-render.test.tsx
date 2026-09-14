import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ReceiptsCard } from '@/components/core-app/screens/ReceiptsCard'
import type { ChimmyAddReceipt, DecisionReceiptsData } from '@/lib/core-app/decisionReceipts'

/*
 * Chimmy's "add X" receipts as rendered (2026-09-14): what Chimmy said, whether you added him, and
 * his points for you — or plainly that you didn't, with no points for a player you passed on.
 */

const add = (over: Partial<ChimmyAddReceipt> = {}): ChimmyAddReceipt => ({
  id: 'af-ice:2026:3:add:11620',
  leagueId: 'af-ice',
  leagueName: 'Ice Kings',
  season: 2026,
  week: 3,
  playerName: 'Jaylen Wright',
  confidencePct: 68,
  added: { week: 3, points: 40, starts: 3, leftWeek: null },
  href: '/core/waivers?league=af-ice',
  ...over,
})

const data = (over: Partial<DecisionReceiptsData> = {}): DecisionReceiptsData => ({
  trades: [],
  tooEarly: 0,
  uncoveredLeagues: 0,
  chimmyAdds: [add()],
  ...over,
})

const resultOf = (container: HTMLElement) =>
  container.querySelector('[data-kind="chimmy-add"] .af3a-receipt-result')?.textContent

describe('ReceiptsCard — Chimmy add calls', () => {
  it('🛑 says what Chimmy said, that you added him, and his points for you', () => {
    const { container } = render(<ReceiptsCard data={data()} />)
    const link = screen.getByRole('link', { name: 'Chimmy said add Jaylen Wright' })
    expect(link.getAttribute('href')).toBe('/core/waivers?league=af-ice')
    expect(screen.getByText('Ice Kings · 2026 wk 3 · 68% confident')).toBeTruthy()
    expect(resultOf(container)).toBe('40.0 pts for you · you added him wk 3 · 3 starts (still yours)')
  })

  it('a stint that ended says when; one start is singular', () => {
    const { container } = render(<ReceiptsCard data={data({ chimmyAdds: [add({ added: { week: 4, points: 7.5, starts: 1, leftWeek: 6 } })] })} />)
    expect(resultOf(container)).toBe('7.5 pts for you · you added him wk 4 · 1 start · gone wk 6')
  })

  it('🛑 you didn’t add him is said plainly, with no points', () => {
    const { container } = render(<ReceiptsCard data={data({ chimmyAdds: [add({ added: null, confidencePct: null })] })} />)
    expect(resultOf(container)).toBe('You didn’t add him.')
    expect(screen.getByText('Ice Kings · 2026 wk 3')).toBeTruthy()
    expect(container.textContent).not.toMatch(/pts/)
  })

  it('🛑 too early, unscored and unknown add calls are counted out loud', () => {
    render(<ReceiptsCard data={data({ chimmyAdds: [], chimmyAddsTooEarly: 2, chimmyAddsUnscored: 1, chimmyAddsUnknown: 1 })} />)
    expect(screen.getByText('2 add calls are too early to call.')).toBeTruthy()
    expect(screen.getByText('1 add you made on Chimmy’s call has no weekly scores on file yet.')).toBeTruthy()
    expect(screen.getByText('1 add call couldn’t be checked yet — your league’s transactions haven’t synced past that week.')).toBeTruthy()
  })

  it('adds alone render the Chimmy section; beside another kind it gets the Chimmy heading', () => {
    render(<ReceiptsCard data={data({ tooEarly: 1 })} />)
    expect(screen.getByRole('heading', { name: 'Chimmy' })).toBeTruthy()
    const { container } = render(<ReceiptsCard data={{ trades: [], tooEarly: 0, uncoveredLeagues: 0, chimmyAdds: [] }} />)
    expect(container.innerHTML).toBe('')
  })
})
