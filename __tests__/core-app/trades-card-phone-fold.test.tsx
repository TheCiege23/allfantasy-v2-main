/**
 * Phone pass, 2026-11-07. Live at 375px one three-for-three trade card was 841px: an In / Out count strip
 * that repeats the player lists, a three-line reasons list, and two grade notes ending in the same
 * caveat. On a phone the strip goes and the explanations fold behind "Why these grades".
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import Trades from '@/components/core-app/screens/Trades'
import type { TradeRecord, TradesData } from '@/lib/core-app/trades'

const trade = (graded: boolean): TradeRecord =>
  ({
    transactionId: 'sleeper:tx-1',
    season: 2026,
    week: 7,
    rosterIds: ['1', '4'],
    yourSide: 'in',
    playersIn: 1,
    playersOut: 1,
    picks: 0,
    partnerTeamName: 'Partner',
    at: new Date('2026-10-20T12:00:00Z'),
    players: [
      {
        manager: 'You FC',
        isYou: true,
        received: [{ sleeperId: '9001', name: 'Got One', position: 'WR', team: 'ATL' }],
        ...(graded ? { grade: 'C', gradeBasis: 'Realized', gradeNote: 'net -5.6 fantasy points while the assets were held.' } : {}),
      },
      {
        manager: 'Partner',
        isYou: false,
        received: [{ sleeperId: '8001', name: 'Gave One', position: 'RB', team: 'SEA' }],
        ...(graded ? { grade: 'C', gradeBasis: 'Realized', gradeNote: 'net 5.6 fantasy points while the assets were held.' } : {}),
      },
    ],
  }) as TradeRecord

const data = (graded: boolean): TradesData =>
  ({
    league: { id: 'l1', name: 'Last League Left', platform: 'sleeper', sourceLink: null },
    gradingContext: { available: true, data: { leagueName: 'Last League Left', format: 'Dynasty · PPR', teamCount: 12 } },
    canonicalHistory: true,
    history: { available: true, data: [trade(graded)] },
    inbox: { available: false, reason: 'not ingested' },
    sent: { available: false, reason: 'not ingested' },
    grades: { available: false, reason: 'nothing priced' },
    deadline: { available: true, data: { week: 11, regularSeasonLength: 14, none: false } },
  }) as TradesData

describe('a trade card on a phone', () => {
  it('folds the grade explanations behind one toggle that marks the card open', () => {
    const { container } = render(<Trades data={data(true)} hidePending />)
    const card = container.querySelector('.af-tr-card')!
    const toggle = screen.getByRole('button', { name: 'How these were graded' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(card.hasAttribute('data-why-open')).toBe(false)
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide how these were graded' }).getAttribute('aria-expanded')).toBe('true')
    expect(card.getAttribute('data-why-open')).toBe('true')
  })

  it('adds no toggle to a card with nothing to explain', () => {
    const { container } = render(<Trades data={data(false)} hidePending />)
    expect(container.querySelector('.af-tr-why-toggle')).toBeNull()
  })

  it('acts only inside a top-level phone query, and hides the toggle everywhere else', () => {
    const css = readFileSync(resolve(process.cwd(), 'components/core-app/af-trades.css'), 'utf8').replace(/\r\n/g, '\n')
    const start = css.lastIndexOf('@media (max-width: 640px) {')
    expect(start).toBeGreaterThan(-1)
    const before = css.slice(0, start)
    // Top level: everything before the block closes every brace it opens.
    expect((before.match(/\{/g) ?? []).length).toBe((before.match(/\}/g) ?? []).length)
    expect(before).toMatch(/\.af-core \.af-tr-why-toggle \{\s*display: none;\s*\}\s*$/)
    const block = css.slice(start)
    expect(block).toMatch(/\.af-tr-card \.af-tr-sides \{\s*display: none;/)
    expect(block).toMatch(/\.af-tr-card:not\(\[data-why-open\]\) \.af-tr-leaguegrade-why \{\s*display: none;/)
    expect(block).toMatch(/-webkit-line-clamp: 2;/)
    expect(block).toMatch(/\.af-core \.af-tr-why-toggle \{\s*display: flex;[^}]*min-height: 44px;/)
  })
})
