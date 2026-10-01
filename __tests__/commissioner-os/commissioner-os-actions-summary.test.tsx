import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CommissionerOsActionsSummary } from '@/components/league-hub/CommissionerOsActionsSummary'

/*
 * The hub admits whoever `getLeagueRole` calls commissioner — which, on an imported league,
 * includes its importer. The recommendations route trusts ownership only on native leagues
 * and 404s an importer who never verified. Pinned: that 404 reads as "verify first", not as
 * a red failure; every other failure still reads as one.
 */

function mockFetch(status: number, body: unknown = {}) {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CommissionerOsActionsSummary', () => {
  it('asks for verification, not an error, when the route 404s an unverified importer', async () => {
    const fetchMock = mockFetch(404, { error: 'League not found or not accessible' })
    render(<CommissionerOsActionsSummary leagueId="league-1" sport="NFL" />)

    expect(await screen.findByTestId('commissioner-os-unverified')).toBeTruthy()
    expect(screen.queryByText('Could not load Commissioner OS for this league')).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/league-hub/context/league-1/commissioner-recommendations',
      expect.objectContaining({ cache: 'no-store' })
    )
  })

  it('still reports a real failure as one', async () => {
    mockFetch(500)
    render(<CommissionerOsActionsSummary leagueId="league-1" sport="NFL" />)

    expect(await screen.findByText('Could not load Commissioner OS for this league')).toBeTruthy()
    expect(screen.queryByTestId('commissioner-os-unverified')).toBeNull()
  })
})
