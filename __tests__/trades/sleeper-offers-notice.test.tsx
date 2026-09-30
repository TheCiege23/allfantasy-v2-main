// @vitest-environment jsdom
/**
 * The Sleeper offers notice (Guap, 2026-09-30): every Sleeper manager is told why an offer waiting in
 * Sleeper is not on AllFantasy, and how to get it graded — enter each manager's assets by hand.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { SleeperOffersNotice, sleeperOfferEntryHref } from '@/components/trades/SleeperOffersNotice'

beforeEach(() => window.localStorage.clear())
afterEach(() => cleanup())

describe('SleeperOffersNotice', () => {
  it('says why the offer is missing and how to enter each manager’s assets', () => {
    render(<SleeperOffersNotice leagueId="L1" />)
    const text = screen.getByTestId('sleeper-offers-notice').textContent ?? ''
    expect(text).toMatch(/only shares a trade after it.s accepted/i)
    expect(text).toMatch(/every player, pick and FAAB each manager would send/i)
  })

  it('links one league straight into the hand-entry builder', () => {
    render(<SleeperOffersNotice leagueId="league 1" />)
    expect(screen.getByRole('link', { name: 'Grade a Sleeper offer' }).getAttribute('href')).toBe(
      '/core/trades?league=league%201&enter=offer',
    )
    expect(sleeperOfferEntryHref('L1')).toBe('/core/trades?league=L1&enter=offer')
  })

  it('on a cross-league screen there is no single league to link, so no button', () => {
    render(<SleeperOffersNotice />)
    expect(screen.queryByRole('link', { name: 'Grade a Sleeper offer' })).toBeNull()
  })

  it('"Got it" hides it, and it stays hidden on the next visit', () => {
    const first = render(<SleeperOffersNotice />)
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByTestId('sleeper-offers-notice')).toBeNull()
    first.unmount()
    render(<SleeperOffersNotice />)
    expect(screen.queryByTestId('sleeper-offers-notice')).toBeNull()
  })
})
