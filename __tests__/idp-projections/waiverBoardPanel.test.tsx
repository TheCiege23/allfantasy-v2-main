import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { WaiverBoardPanel } from '@/components/waiver-wire/WaiverBoardPanel'

/**
 * The panel that answers "who is worth adding". The route it replaces
 * (`/api/ai/waivers/recommend`) returns the literal ["WR_depth","RB_depth","TE_upgrade"] to
 * every manager in every league.
 *
 * The payload shape here is copied from a real production response for Last League Left.
 */

const PAYLOAD = {
  state: 'ok',
  season: '2025',
  week: 18,
  currentLineupPoints: 234.91,
  candidates: [
    {
      sleeperId: '1',
      name: 'Blake Cashman',
      position: 'LB',
      team: 'MIN',
      projectedPoints: 21.08,
      gain: 6.55,
      displaces: { sleeperId: 'x', name: 'Patrick Queen', projectedPoints: 14.53 },
    },
    {
      sleeperId: '2',
      name: 'Open Slot Guy',
      position: 'DL',
      team: 'SF',
      projectedPoints: 9.4,
      gain: 9.4,
      displaces: null,
    },
  ],
  notes: ['40 free agents would improve your lineup; showing the top 10.'],
}

const mockFetch = (body: unknown, ok = true) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })) as never)

afterEach(() => vi.unstubAllGlobals())

describe('WaiverBoardPanel', () => {
  it('leads with the gain and names who it displaces', async () => {
    /*
     * The gain is the whole point. Sorting by projection reproduces a rankings page — a big name
     * tops the board whether or not he would crack your lineup — so the row has to carry both
     * the number and the incumbent it is measured against.
     */
    mockFetch(PAYLOAD)
    render(<WaiverBoardPanel leagueId="lg1" />)

    await waitFor(() => expect(screen.getByTestId('waiver-board-panel')).toBeTruthy())
    /*
     * One decimal, matching the projection column beside it — 6.55 renders as +6.5. JSX also
     * splits the `+` from the number into separate text nodes, so this matches on the panel.
     */
    expect(screen.getByTestId('waiver-board-panel').textContent).toContain('+6.5')
    expect(screen.getByText(/Patrick Queen/)).toBeTruthy()
    expect(screen.getByText('Blake Cashman')).toBeTruthy()
  })

  it('says "an empty slot" rather than naming nobody', async () => {
    // A candidate who fills an unfilled slot displaces no one; a blank cell there reads as a bug.
    mockFetch(PAYLOAD)
    render(<WaiverBoardPanel leagueId="lg1" />)
    await waitFor(() => expect(screen.getByText('an empty slot')).toBeTruthy())
  })

  it('carries the coverage note with the ranking', async () => {
    // A board built from a third of the wire is a different claim from one built off all of it.
    mockFetch(PAYLOAD)
    render(<WaiverBoardPanel leagueId="lg1" />)
    await waitFor(() => expect(screen.getByText(/40 free agents/)).toBeTruthy())
  })

  it('states the finding when nobody would improve the lineup', async () => {
    // Not an error — a real answer, and the manager should not go hunting for a bug.
    mockFetch({ ...PAYLOAD, candidates: [] })
    render(<WaiverBoardPanel leagueId="lg1" />)
    await waitFor(() => expect(screen.getByText(/would improve your starting lineup/)).toBeTruthy())
  })

  it('explains a refusal instead of rendering an empty table', async () => {
    mockFetch({ ...PAYLOAD, state: 'no_team_claimed', candidates: [] })
    render(<WaiverBoardPanel leagueId="lg1" />)
    await waitFor(() => expect(screen.getByText(/Claim your team/)).toBeTruthy())
  })

  it('renders nothing at all when the request fails', async () => {
    /*
     * The waiver wire underneath is the real surface. An opinion layer that cannot form an
     * opinion should disappear, not leave a broken card sitting above a working page.
     */
    mockFetch(null, false)
    const { container } = render(<WaiverBoardPanel leagueId="lg1" />)
    await waitFor(() => expect(container.textContent).toBe(''))
  })
})
