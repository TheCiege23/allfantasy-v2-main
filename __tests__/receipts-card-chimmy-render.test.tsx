import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ReceiptsCard } from '@/components/core-app/screens/ReceiptsCard'
import type { ChimmyReceipt, DecisionReceiptsData } from '@/lib/core-app/decisionReceipts'

/*
 * Chimmy advice receipts as rendered (2026-09-14): what Chimmy SAID, how confident it was, both
 * players' points, whether it was right, and what your Sleeper lineup actually did.
 */

const call = (over: Partial<ChimmyReceipt> = {}): ChimmyReceipt => ({
  id: 'af-ice:2026:5:in:out',
  leagueId: 'af-ice',
  leagueName: 'Ice Kings',
  season: 2026,
  week: 5,
  slot: 'FLEX',
  recommended: { name: 'Jahmyr Gibbs', points: 18.2 },
  instead: { name: 'Sam LaPorta', points: 6 },
  followed: 'yes',
  call: 'right',
  href: '/core/my-team?league=af-ice',
  confidencePct: 64,
  ...over,
})

const data = (over: Partial<DecisionReceiptsData> = {}): DecisionReceiptsData => ({
  trades: [],
  tooEarly: 0,
  uncoveredLeagues: 0,
  chimmy: [call()],
  ...over,
})

describe('ReceiptsCard — Chimmy', () => {
  it('🛑 says what Chimmy SAID, its confidence, both players’ points, the verdict and what you did', () => {
    const { container } = render(<ReceiptsCard data={data()} />)
    const link = screen.getByRole('link', { name: 'Chimmy said start Jahmyr Gibbs over Sam LaPorta' })
    expect(link.getAttribute('href')).toBe('/core/my-team?league=af-ice')
    expect(screen.getByText('Ice Kings · 2026 wk 5 · FLEX · 64% confident')).toBeTruthy()
    expect(screen.getByText(/Sam LaPorta 6\.0 — Chimmy was right/)).toBeTruthy()
    expect(screen.getByText('You started Jahmyr Gibbs on Sleeper.')).toBeTruthy()
    expect(container.querySelector('li')?.getAttribute('data-kind')).toBe('chimmy')
    expect(container.querySelector('li')?.getAttribute('data-outcome')).toBe('ahead')
  })

  it('a wrong call reads as wrong; no confidence on file shows none', () => {
    render(<ReceiptsCard data={data({ chimmy: [call({ call: 'wrong', followed: 'no', confidencePct: null })] })} />)
    expect(screen.getByText(/Chimmy was wrong/)).toBeTruthy()
    expect(screen.getByText('Ice Kings · 2026 wk 5 · FLEX')).toBeTruthy()
  })

  it('🛑 pending, unscored and unreadable Chimmy calls are counted out loud', () => {
    render(<ReceiptsCard data={data({ chimmy: [], chimmyPending: 1, chimmyUnscored: 2, chimmyUnreadable: 1 })} />)
    expect(screen.getByText('1 Chimmy call is for a week still being played.')).toBeTruthy()
    expect(screen.getByText('2 calls have no weekly scores on file yet.')).toBeTruthy()
    expect(screen.getByText('1 call couldn’t be matched to a week or to your roster that week.')).toBeTruthy()
  })

  it('beside AutoCoach, each gets its own heading and its own name in the copy', () => {
    render(<ReceiptsCard data={data({ autocoach: [call({ id: 'ac', confidencePct: undefined as never })] })} />)
    expect(screen.getByRole('heading', { name: 'AutoCoach' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Chimmy' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'AutoCoach said start Jahmyr Gibbs over Sam LaPorta' })).toBeTruthy()
  })

  it('with no Chimmy data the section is absent; with nothing at all the card is empty', () => {
    const { container } = render(<ReceiptsCard data={{ trades: [], tooEarly: 0, uncoveredLeagues: 0, chimmy: [] }} />)
    expect(container.innerHTML).toBe('')
  })
})
