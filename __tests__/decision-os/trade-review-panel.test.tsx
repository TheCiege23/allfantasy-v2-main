/**
 * The commissioner review panel (design step 6): it shows the code's recommendation and flags, lists
 * the checks it could NOT run with their reasons, and remembers the review id for the decision buttons.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { TradeReviewPanel } from '@/components/trade-review/TradeReviewPanel'
import { reviewIdFor } from '@/lib/trade-review/reviewIdStore'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const BODY = {
  review: {
    model: 'trade-review-v1',
    recommendation: 'consider_veto',
    flags: [{ code: 'heavily_lopsided', severity: 'high', explanation: 'Bravo receives 48% more league value.' }],
    checks: [
      { code: 'heavily_lopsided', severity: 'high', status: 'raised', explanation: 'Bravo receives 48% more league value.' },
      { code: 'tanking_signal', severity: 'high', status: 'clear', explanation: 'x' },
      { code: 'eliminated_team_dumping', severity: 'medium', status: 'not_computed', explanation: 'No season forecast has been run for this league.' },
    ],
  },
  sides: ['Alpha', 'Bravo'],
  tradeGrade: { grade: 'F', partnerGrade: 'A', gradeWithheld: null },
  reviewId: 'rcpt_panel',
  explanation: { noteToLeague: 'Flagged for the commissioner: a heavily lopsided value gap.', headline: 'h', source: 'template' },
  actOn: null,
}

async function open(body: unknown, ok = true, tradeId = 't1') {
  const fetchMock = vi.fn(async () => ({ ok, json: async () => body }))
  vi.stubGlobal('fetch', fetchMock)
  render(<TradeReviewPanel leagueId="L1" tradeId={tradeId} kind="af" />)
  await act(async () => { fireEvent.click(screen.getByTestId('trade-review-toggle')) })
  return fetchMock
}

describe('TradeReviewPanel', () => {
  it('fetches the review for this trade, with the explanation, only once opened', async () => {
    const fetchMock = await open(BODY)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/leagues/L1/trades/t1/review?kind=af&explain=1')
  })

  it('shows the recommendation, the one grade, the note and the raised flag', async () => {
    await open(BODY)
    expect(screen.getByTestId('trade-review-recommendation').textContent).toBe('Consider a veto')
    expect(screen.getByTestId('trade-review-grade').textContent).toBe('Alpha F · Bravo A')
    expect(screen.getByTestId('trade-review-note').textContent).toMatch(/heavily lopsided/)
    expect(screen.getByTestId('trade-review-flags').textContent).toMatch(/Heavily lopsided.*Bravo receives 48% more/)
  })

  it('lists what it could NOT check, with why — never folds it into "clear"', async () => {
    await open(BODY)
    expect(screen.getByTestId('trade-review-not-checked').textContent).toMatch(/Eliminated team dumping: No season forecast/)
    expect(screen.getByTestId('trade-review-clear').textContent).toBe('Clear: Tanking signal')
    expect(screen.getByTestId('trade-review-clear').textContent).not.toMatch(/Eliminated/)
  })

  it('remembers the review id so the decision can log it', async () => {
    await open(BODY, true, 't-remember')
    expect(reviewIdFor('t-remember')).toBe('rcpt_panel')
  })

  it('says the app never acts on its own', async () => {
    await open(BODY)
    expect(screen.getByText(/never approves or vetoes a trade on its own/)).toBeTruthy()
  })

  it('shows the error rather than an empty review', async () => {
    await open({ error: 'Only the commissioner or a co-commissioner can review a trade.' }, false)
    expect(screen.getByText('Only the commissioner or a co-commissioner can review a trade.')).toBeTruthy()
    expect(screen.queryByTestId('trade-review-recommendation')).toBeNull()
  })
})
