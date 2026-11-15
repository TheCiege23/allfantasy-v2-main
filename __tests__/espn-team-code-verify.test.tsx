/**
 * The phone panel for ESPN commissioners (`EspnTeamCodeVerify`). What matters to the person holding
 * the phone: the code is on screen, "not there yet" keeps them where they are, and only a found code
 * hands back to the import screen (which re-runs the preview so the gate can see it).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { EspnTeamCodeVerify } from '@/components/core-app/import/EspnTeamCodeVerify'

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('EspnTeamCodeVerify', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows the code, keeps them in place while it is missing, and hands back once found', async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ ok: true, code: 'K9X2', leagueId: '123456' }))
      .mockResolvedValueOnce(reply({ ok: true, code: 'K9X2', found: false }))
      .mockResolvedValueOnce(reply({ ok: true, code: 'K9X2', found: true, teamName: 'Tribal Beef' }))
    const onVerified = vi.fn()
    render(<EspnTeamCodeVerify leagueInput="2026:123456" onVerified={onVerified} />)

    expect(await screen.findByText('K9X2')).toBeTruthy()
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body).toEqual({ mode: 'team_code', leagueId: '2026:123456' })

    fireEvent.click(screen.getByTestId('espn-team-code-check'))
    expect(await screen.findByText(/don't see K9X2 on any team/)).toBeTruthy()
    expect(onVerified).not.toHaveBeenCalled()
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).check).toBe(true)

    fireEvent.click(screen.getByTestId('espn-team-code-check'))
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1))
    expect(screen.getByText(/Confirmed: Tribal Beef/)).toBeTruthy()
  })

  it('says a private league cannot use a code, rather than "not there yet"', async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ ok: true, code: 'K9X2' }))
      .mockResolvedValueOnce(reply({ ok: true, code: 'K9X2', found: false, reason: 'private', message: 'This league is private.' }))
    render(<EspnTeamCodeVerify leagueInput="123456" onVerified={vi.fn()} />)
    await screen.findByText('K9X2')
    fireEvent.click(screen.getByTestId('espn-team-code-check'))
    expect(await screen.findByText('This league is private.')).toBeTruthy()
  })

  it('renders nothing when codes are unavailable, so the cookie path stands alone', async () => {
    fetchMock.mockResolvedValueOnce(reply({ error: 'Team codes are not available right now.' }, 503))
    const { container } = render(<EspnTeamCodeVerify leagueInput="123456" onVerified={vi.fn()} />)
    await waitFor(() => expect(container.querySelector('[data-testid="espn-team-code"]')).toBeNull())
  })
})
