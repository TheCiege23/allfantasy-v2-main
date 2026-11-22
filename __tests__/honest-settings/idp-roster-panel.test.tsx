/**
 * The IDP Roster tab edits the league's IDP config (2026-11-15).
 *
 * 🛑 It was a mock-up: local DL / LB / DB counts, no league, nothing saved. It now loads and saves the position mode
 * and roster preset the lineup template reads, shows the starters that produces, and reports the route's refusals.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { IDPRosterPanel } from '@/app/idp/components/settings/IDPRosterPanel'

const fetchMock = vi.fn()
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const loaded = (over: Record<string, unknown> = {}) =>
  reply(200, {
    config: { positionMode: 'standard', rosterPreset: 'standard', settingsLockedAt: null, ...over },
    rosterPreview: { starterSlots: { QB: 1, DL: 2, LB: 2, DB: 2, IDP_FLEX: 1 } },
  })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('the IDP Roster tab', () => {
  it('shows the league\'s defensive layout and saves a new preset to the IDP config', async () => {
    fetchMock.mockResolvedValueOnce(loaded()).mockResolvedValueOnce(reply(200, { config: {} })).mockResolvedValueOnce(loaded({ rosterPreset: 'advanced' }))
    render(<IDPRosterPanel leagueId="L1" canEdit />)
    expect((await screen.findByTestId('idp-roster-preview')).textContent).toBe('QB 1 · DL 2 · LB 2 · DB 2 · IDP_FLEX 1')
    fireEvent.click(screen.getByText('Advanced IDP'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const [url, init] = fetchMock.mock.calls[1]!
    expect(url).toBe('/api/leagues/L1/idp/config')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ rosterPreset: 'advanced' })
  })

  it('shows the route\'s refusal, and a locked layout cannot be changed', async () => {
    fetchMock.mockResolvedValueOnce(loaded()).mockResolvedValueOnce(reply(423, { error: 'Format rules are locked for the season.' }))
    render(<IDPRosterPanel leagueId="L1" canEdit />)
    fireEvent.click(await screen.findByText('Hybrid (grouped + split)'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/locked/)

    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(loaded({ settingsLockedAt: '2026-09-01T00:00:00Z' }))
    render(<IDPRosterPanel leagueId="L2" canEdit />)
    expect(await screen.findByTestId('idp-roster-locked')).toBeTruthy()
    expect((screen.getAllByText('Beginner IDP').at(-1) as HTMLButtonElement).disabled).toBe(true)
  })
})
