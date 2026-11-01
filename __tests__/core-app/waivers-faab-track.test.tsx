import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { Waivers, faabTrack } from '@/components/core-app/screens/Waivers'
import type { WaiversData } from '@/lib/core-app/waivers'

/**
 * Batch B5: the FAAB tile's bar on /core Waivers (drawn by af-core-redraft-waivers-finder.css under the
 * redraft stamp only). It is a share of two REAL figures — your FAAB left and the league's budget — and
 * it must not appear when either is unknown, because a bar with an invented denominator is a number the
 * screen does not have. The tile's text and the screen's testids are unchanged.
 */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function data(over: Partial<WaiversData> = {}): WaiversData {
  return {
    league: { id: 'L1', name: 'Sunday Night Redraft', platform: 'sleeper', format: null, platformLeagueId: 'S1' },
    budget: { available: true, data: { faabRemaining: 63, rankByBudget: 4, rostersWithBudget: 12 } },
    waiverPriority: { available: true, data: { priority: 7, leagueRosters: 12 } },
    rosterLoad: { available: false, reason: 'x' },
    claimsQueued: { available: false, reason: 'x' },
    waiverType: { available: true, data: { kind: 'faab', label: 'FAAB blind bidding', budget: 100 } },
    processTime: {
      available: true,
      data: { schedule: { dayOfWeek: 3, time: '03:00', timeZone: 'America/Los_Angeles' }, dayLabel: 'Wednesday', timeLabel: '03:00 Pacific', observedRuns: 6 },
    },
    tiebreak: { available: true, data: 'Rolling waiver priority' },
    claimLimits: { available: false, reason: 'x' },
    ...over,
  } as WaiversData
}

const renderWaivers = (d: WaiversData) => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})) as never)
  return render(<Waivers data={d} edge={null} edgeAccess={null} />)
}

describe('faabTrack', () => {
  it.each([
    [63, 100, 0.63],
    [0, 100, 0],
    [100, 100, 1],
    [63, null, null],
    [null, 100, null],
    [63, 0, null],
    [120, 100, null], // a top-up the budget column does not reflect: not pinned at 100%
    [-5, 100, null],
    [Number.NaN, 100, null],
  ])('(%s of %s) → %s', (remaining, budget, expected) => {
    expect(faabTrack(remaining as number | null, budget as number | null)).toBe(expected)
  })
})

describe('Waivers — the FAAB bar', () => {
  it('draws the share of the league budget left, inside the FAAB tile, hidden from assistive tech', () => {
    const { container } = renderWaivers(data())
    const track = screen.getByTestId('waiver-faab-track')
    expect(track.getAttribute('aria-hidden')).toBe('true')
    expect((track.firstElementChild as HTMLElement).style.width).toBe('63%')
    const tile = container.querySelector('.af-wv-tile[data-tile="faab"]')
    expect(tile?.contains(track)).toBe(true)
    // The tile still says the figure in text; the bar adds nothing a reader would miss.
    expect(tile?.textContent).toContain('$63')
  })

  it('is absent when the league budget is not on file', () => {
    renderWaivers(data({ waiverType: { available: true, data: { kind: 'faab', label: 'FAAB blind bidding', budget: null } } }))
    expect(screen.queryByTestId('waiver-faab-track')).toBeNull()
  })

  it('is absent in a rolling-priority league, even with a budget figure lying around', () => {
    renderWaivers(data({ waiverType: { available: true, data: { kind: 'rolling', label: 'Rolling waiver priority', budget: 100 } } }))
    expect(screen.queryByTestId('waiver-faab-track')).toBeNull()
  })

  it('is absent when the platform does not publish your FAAB', () => {
    renderWaivers(data({ budget: { available: false, reason: 'this platform does not publish remaining FAAB' } }))
    expect(screen.queryByTestId('waiver-faab-track')).toBeNull()
    // The honesty rule: an unknown budget is a dash and a sentence, never "$0".
    expect(document.querySelector('.af-wv-tile[data-tile="faab"]')?.getAttribute('data-missing')).toBe('true')
  })

  it('keeps every testid the screen had', () => {
    renderWaivers(data())
    expect(screen.getByTestId('waiver-next-run')).toBeTruthy()
    expect(screen.getByTestId('waiver-rules')).toBeTruthy()
  })
})
