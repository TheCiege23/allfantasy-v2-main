import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ReceiptsCard } from '@/components/core-app/screens/ReceiptsCard'
import type { AutoCoachReceipt, DecisionReceiptsData } from '@/lib/core-app/decisionReceipts'

/*
 * AutoCoach receipts as rendered (2026-09-14): what AutoCoach SAID (never "started" — on an
 * imported league the swap does not reach Sleeper), both players' points, whether it was right,
 * and what your Sleeper lineup actually did.
 */

const call = (over: Partial<AutoCoachReceipt> = {}): AutoCoachReceipt => ({
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
  ...over,
})

const data = (over: Partial<DecisionReceiptsData> = {}): DecisionReceiptsData => ({
  trades: [],
  tooEarly: 0,
  uncoveredLeagues: 0,
  autocoach: [call()],
  autocoachPending: 0,
  autocoachUnscored: 0,
  autocoachUnreadable: 0,
  ...over,
})

describe('ReceiptsCard — AutoCoach', () => {
  it('🛑 says what AutoCoach SAID, both players’ points, the verdict, and what your Sleeper lineup did', () => {
    const { container } = render(<ReceiptsCard data={data()} />)
    const link = screen.getByRole('link', { name: 'AutoCoach said start Jahmyr Gibbs over Sam LaPorta' })
    expect(link.getAttribute('href')).toBe('/core/my-team?league=af-ice')
    expect(screen.getByText('Ice Kings · 2026 wk 5 · FLEX')).toBeTruthy()
    expect(screen.getByText('Jahmyr Gibbs 18.2')).toBeTruthy()
    expect(screen.getByText(/Sam LaPorta 6\.0 — AutoCoach was right/)).toBeTruthy()
    expect(screen.getByText('You started Jahmyr Gibbs on Sleeper.')).toBeTruthy()
    expect(container.querySelector('li')?.getAttribute('data-outcome')).toBe('ahead')
    expect(screen.queryByText(/AutoCoach started/)).toBeNull()
  })

  it('🛑 a wrong call you did not follow is said plainly', () => {
    const { container } = render(<ReceiptsCard data={data({ autocoach: [call({ call: 'wrong', followed: 'no' })] })} />)
    expect(screen.getByText(/AutoCoach was wrong/)).toBeTruthy()
    expect(screen.getByText('You kept Sam LaPorta in on Sleeper.')).toBeTruthy()
    expect(container.querySelector('li')?.getAttribute('data-outcome')).toBe('behind')
  })

  it('an unclear lineup and a close call are said as such', () => {
    render(<ReceiptsCard data={data({ autocoach: [call({ call: 'same', followed: 'unclear' })] })} />)
    expect(screen.getByText(/about the same/)).toBeTruthy()
    expect(screen.getByText('Your Sleeper lineup didn’t match either way.')).toBeTruthy()
  })

  it('🛑 pending, unscored and unreadable calls are counted out loud, never shown as numbers', () => {
    render(<ReceiptsCard data={data({ autocoach: [], autocoachPending: 2, autocoachUnscored: 1, autocoachUnreadable: 3 })} />)
    expect(screen.getByText('2 AutoCoach calls are for a week still being played.')).toBeTruthy()
    expect(screen.getByText('1 call has no weekly scores on file yet.')).toBeTruthy()
    expect(screen.getByText(/3 calls couldn’t be matched to a week/)).toBeTruthy()
  })

  it('with another kind present, AutoCoach gets its own heading; with nothing, the card is empty', () => {
    render(<ReceiptsCard data={data({ tooEarly: 1 })} />)
    expect(screen.getByRole('heading', { name: 'AutoCoach' })).toBeTruthy()
    const { container } = render(<ReceiptsCard data={{ trades: [], tooEarly: 0, uncoveredLeagues: 0, autocoach: [] }} />)
    expect(container.innerHTML).toBe('')
  })
})
